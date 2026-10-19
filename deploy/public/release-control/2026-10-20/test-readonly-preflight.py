import copy, runpy, sys, unittest
scope = runpy.run_path(sys.argv[1])
select = scope["manifest_sections"]
class ManifestTests(unittest.TestCase):
    def sample(self):
        return {"candidate":{"gateway/current.cjs":"a"*64},"previous":{"gateway/previous.cjs":"b"*64}}
    def test_nested_manifest_selects_correct_section(self):
        value=self.sample()
        self.assertEqual(select(value), value)
        self.assertEqual(select(value)["previous"], {"gateway/previous.cjs":"b"*64})
    def test_flat_manifest_rejected(self):
        with self.assertRaises(ValueError): select({"gateway/current.cjs":"a"*64})
    def test_missing_section_rejected(self):
        with self.assertRaises(ValueError): select({"candidate":{"app.cjs":"a"*64}})
    def test_non_map_section_rejected(self):
        value=self.sample();value["candidate"]=[]
        with self.assertRaises(ValueError): select(value)
    def test_empty_section_rejected(self):
        value=self.sample();value["previous"]={}
        with self.assertRaises(ValueError): select(value)
    def test_unsafe_paths_rejected(self):
        for name in ("../secret","/etc/secret","a/../b","a//b","a/./b","C:/secret",r"a\b","a\x00b"):
            with self.subTest(path=name):
                value=self.sample();value["candidate"]={name:"a"*64}
                with self.assertRaises(ValueError): select(value)
    def test_invalid_digest_rejected(self):
        for digest in ("x"*64,"a"*63,True,{}):
            with self.subTest(kind=type(digest).__name__):
                value=self.sample();value["candidate"]={"app.cjs":digest}
                with self.assertRaises(ValueError): select(value)
    def test_non_map_manifest_rejected(self):
        for value in (None,[],True,"flat"):
            with self.subTest(kind=type(value).__name__):
                with self.assertRaises(ValueError): select(value)
    def test_input_preserved_and_sections_copied(self):
        value=self.sample();original=copy.deepcopy(value);selected=select(value)
        self.assertEqual(value,original);selected["candidate"]["other.cjs"]="c"*64
        self.assertEqual(value,original)
if len(sys.argv)>2 and sys.argv[2]=="--baseline":
    select=lambda value:{"candidate":value,"previous":value}
    suite=unittest.TestSuite([ManifestTests("test_nested_manifest_selects_correct_section")])
else:
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(ManifestTests)
result=unittest.TextTestRunner(verbosity=2).run(suite)
print("CONTRACT_COUNTS="+str((result.testsRun,len(result.failures),len(result.errors),len(result.skipped))))
sys.exit(0 if result.wasSuccessful() else 1)
