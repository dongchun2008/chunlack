import importlib.util,os,json,subprocess,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
ROOT=Path(os.environ.get("CHUNLACK_HANDOFF_REPO",str(Path(__file__).resolve().parents[4])))
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
r=load("handoff_control",ROOT/"deploy/public/release-control/2026-10-17/release-discovery-safe-20261017.py")
launcher=load("handoff_launcher",ROOT/"deploy/public/release-control/2026-10-19/launch-controlled-release.py")
TAG="abcdef012345"
NODE="/opt/chunlack-public/runtime/node/bin/node"
DATA="/opt/chunlack-public/staged-"+TAG+"/schema-check/data"
class HandoffTests(unittest.TestCase):
 def setUp(self):
  self.assertTrue(callable(getattr(r,"service_probe_arguments",None)),"systemd account handoff helper is missing")
 def args(self,**kwargs):
  return r.service_probe_arguments(TAG,"readable",[NODE,"-e","void 0"],**kwargs)
 def identity(self,uid=996,gid=987,slice_name=None,nnp=True):
  return json.dumps({"serviceProbe":"readable","uid":uid,"gid":gid,"slice":slice_name or r.handoff_slice(TAG),"noNewPrivileges":nnp}).encode()+b"\n"
 def test_01_direct_service_account_not_runuser(self):
  args=self.args()
  self.assertIn("--property=User=chunlack-public",args);self.assertIn("--property=Group=chunlack-public",args)
  self.assertNotIn("/usr/sbin/runuser",args);self.assertNotIn("--property=User=root",args)
 def test_02_all_safety_and_resource_limits_retained(self):
  args=self.args()
  for value in ["MemoryMax=192M","MemoryHigh=160M","MemorySwapMax=0","CPUQuota=10%","TasksMax=32","NoNewPrivileges=yes","PrivateNetwork=yes","PrivateTmp=yes","PrivateDevices=yes","ProtectSystem=strict","ProtectHome=yes","IPAddressDeny=any","IPAddressAllow=localhost"]:
   self.assertIn("--property="+value,args)
 def test_03_shared_slice_and_owned_unit_bound_to_tag(self):
  args=self.args()
  self.assertIn("--property=Slice=chunlackhandoff"+TAG+".slice",args)
  self.assertIn("--unit=chunlack-handoff-"+TAG+"-readable.service",args)
 def test_04_unsafe_tags_and_probe_names_rejected(self):
  for tag in ["",None,"ABCDEF012345","abcdef012345/../other"]:
   with self.subTest(tag=tag),self.assertRaises(RuntimeError):r.service_probe_arguments(tag,"readable",[NODE,"-e","void 0"])
  with self.assertRaises(RuntimeError):r.service_probe_arguments(TAG,"tailscaled",[NODE,"-e","void 0"])
 def test_05_private_copy_only_write_access(self):
  args=self.args(data_root=DATA)
  self.assertIn("--property=ReadWritePaths="+DATA,args)
  self.assertIn("--property=WorkingDirectory="+DATA,args)
  self.assertFalse(any(a=="--property=ReadWritePaths=/var/lib/chunlack-public" for a in args))
 def test_06_production_or_linklike_write_paths_rejected(self):
  for path in ["/var/lib/chunlack-public",DATA+"/../other",DATA+"/","/tmp/data"]:
   with self.subTest(path=path),self.assertRaises(RuntimeError):self.args(data_root=path)
 def test_07_only_test_environment_file_can_be_used(self):
  args=self.args(env_file="/var/lib/chunlack-release-"+TAG+"/isolation.env")
  self.assertIn("--property=EnvironmentFile=/var/lib/chunlack-release-"+TAG+"/isolation.env",args)
  with self.assertRaises(RuntimeError):self.args(env_file="/etc/chunlack-public/runtime.env")
 def test_08_probe_deadline_cannot_expand_original_budget(self):
  for seconds in [True,0,5,41,100]:
   with self.subTest(seconds=seconds),self.assertRaises(RuntimeError):self.args(seconds=seconds)
  self.assertIn("--property=RuntimeMaxSec=10",self.args(seconds=15))
 def test_09_only_explicit_handoff_mode_is_accepted(self):
  self.assertFalse(r.service_handoff_enabled({}));self.assertTrue(r.service_handoff_enabled({"serviceAccountHandoff":"systemd-v1"}))
  for value in [True,"",[],{},"unsafe"]:
   with self.subTest(value=value),self.assertRaises(RuntimeError):r.service_handoff_enabled({"serviceAccountHandoff":value})
 def test_10_actual_identity_proof_required(self):
  self.assertEqual(r.validate_service_identity(self.identity(),996,987,TAG)["uid"],996)
 def test_11_root_wrong_group_or_wrong_slice_is_rejected(self):
  for output in [self.identity(uid=0),self.identity(gid=0),self.identity(slice_name="system.slice"),self.identity(nnp=False)]:
   with self.subTest(output=output),self.assertRaises(RuntimeError):r.validate_service_identity(output,996,987,TAG)
 def test_12_missing_or_duplicate_identity_is_rejected(self):
  for output in [b"",b"readable\n",self.identity()+self.identity()]:
   with self.subTest(output=output),self.assertRaises(RuntimeError):r.validate_service_identity(output,996,987,TAG)
 def test_13_failure_still_stops_only_owned_probe(self):
  completed=subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
  with mock.patch.object(r.subprocess,"run",side_effect=[subprocess.TimeoutExpired(["systemd-run"],13),completed]) as run,mock.patch.object(r.Path,"exists",return_value=False):
   with self.assertRaises(subprocess.TimeoutExpired):r.run_service_probe(TAG,"readable",[NODE,"-e","void 0"],seconds=15)
   self.assertEqual(run.call_args_list[-1].args[0],["systemctl","stop","chunlack-handoff-"+TAG+"-readable.service"])
 def test_14_nonzero_child_exit_is_not_success(self):
  failed=subprocess.CompletedProcess([],1,stdout=b"",stderr=b"denied")
  stopped=subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
  with mock.patch.object(r.subprocess,"run",side_effect=[failed,stopped]),mock.patch.object(r.Path,"exists",return_value=False):
   self.assertEqual(r.run_service_probe(TAG,"readable",[NODE,"-e","void 0"],seconds=15).returncode,1)
 def test_15_cleanup_failure_is_not_ignored(self):
  good=subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
  bad=subprocess.CompletedProcess([],1,stdout=b"",stderr=b"")
  with mock.patch.object(r.subprocess,"run",side_effect=[good,bad]),mock.patch.object(r.Path,"exists",return_value=False):
   with self.assertRaises(RuntimeError):r.run_service_probe(TAG,"readable",[NODE,"-e","void 0"],seconds=15)
 def test_16_slice_limits_are_verified(self):
  good=subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
  wrong=subprocess.CompletedProcess([],0,stdout=b"MemoryMax=infinity\nCPUQuotaPerSecUSec=infinity\nTasksMax=32\nMemorySwapMax=0\n",stderr=b"")
  with mock.patch.object(r.subprocess,"run",side_effect=[good,wrong]):
   with self.assertRaises(RuntimeError):r.configure_handoff_slice(TAG)
 def test_17_legacy_launcher_is_unchanged(self):
  args=launcher.release_arguments("/var/lib/chunlack-release-"+TAG)
  self.assertFalse(any(a.startswith("--property=Slice=") for a in args))
 def test_18_handoff_launcher_preserves_window_and_limits(self):
  args=launcher.release_arguments("/var/lib/chunlack-release-"+TAG,service_account_handoff=True)
  self.assertIn("--property=Slice=chunlackhandoff"+TAG+".slice",args)
  for value in ["MemoryMax=192M","CPUQuota=10%","TasksMax=32","NoNewPrivileges=yes","RuntimeMaxSec=180","TimeoutStopSec=130"]:
   self.assertIn("--property="+value,args)
  self.assertEqual(args[-4:],["/usr/bin/python3","-B","/var/lib/chunlack-release-"+TAG+"/release.py","/var/lib/chunlack-release-"+TAG])
 def test_19_nonboolean_launcher_mode_rejected(self):
  with self.assertRaises(ValueError):launcher.release_arguments("/var/lib/chunlack-release-"+TAG,service_account_handoff="yes")
 def backend(self,slice_name=None,budget=15):
  b=r.LinuxBackend.__new__(r.LinuxBackend);b.tag=TAG;b.settings={"serviceAccountHandoff":"systemd-v1"}
  b.staged=Path("/opt/chunlack-public/staged-"+TAG+"/current");b.app_uid=996;b.app_gid=987
  b.w=SimpleNamespace(remaining=lambda cap=20:min(cap,budget),tick=lambda:None)
  calls=[]
  def command(args,cap=3):
   calls.append(args)
   if args[0:2]==["systemctl","show"]:return (slice_name or r.handoff_slice(TAG))+"\n"
   raise AssertionError("unexpected root command")
  b.command=command
  return b,calls
 def test_20_release_preflight_uses_real_nonroot_probe(self):
  b,calls=self.backend();result=subprocess.CompletedProcess([],0,stdout=self.identity(),stderr=b"")
  with mock.patch.object(r,"configure_handoff_slice"),mock.patch.object(r,"run_service_probe",return_value=result) as probe:
   b.check_service_readability()
   self.assertTrue(probe.called);self.assertTrue(all("/usr/sbin/runuser" not in c for c in calls))
 def test_21_wrong_controller_slice_fails_before_business_start(self):
  b,_=self.backend(slice_name="system.slice")
  with mock.patch.object(r,"configure_handoff_slice") as configure,mock.patch.object(r,"run_service_probe") as probe:
   with self.assertRaises(RuntimeError):b.check_service_readability()
   configure.assert_not_called();probe.assert_not_called()
 def test_22_no_budget_fails_before_business_start(self):
  b,_=self.backend(budget=2)
  with mock.patch.object(r,"configure_handoff_slice"),mock.patch.object(r,"run_service_probe") as probe:
   with self.assertRaises(RuntimeError):b.check_service_readability()
   probe.assert_not_called()
if __name__=="__main__":unittest.main()
