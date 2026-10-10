'use strict';
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const {execFileSync}=require('node:child_process');
function windowsAcl(file,protect){
  const encoded=Buffer.from(file,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; `+
    (protect?"$acl=New-Object Security.AccessControl.FileSecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach($who in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){$rule=New-Object Security.AccessControl.FileSystemAccessRule($who,'FullControl','Allow'); $acl.AddAccessRule($rule)}; [IO.File]::SetAccessControl($p,$acl); ":'')+
    "$a=[IO.File]::GetAccessControl($p); if(!$a.AreAccessRulesProtected){throw 'Credential ACL is inherited'}; if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Credential owner mismatch'}; foreach($r in $a.Access){$v=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($r.AccessControlType -eq 'Allow' -and $v -ne $sid.Value -and $v -ne 'S-1-5-18'){throw 'Credential ACL too broad'}}";
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});
}
function check(file){const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe credential file');if(process.platform==='win32')windowsAcl(file,false);else if(info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Credential file permissions too broad');}
function saveCredentials(file,value){
  const parent=path.dirname(path.resolve(file));fs.mkdirSync(parent,{recursive:true,mode:0o700});if(fs.lstatSync(parent).isSymbolicLink())throw new Error('Credential directory is a link');
  if(fs.existsSync(file))check(file);
  const temp=path.join(parent,'.credential-'+randomUUID());
  try{fs.closeSync(fs.openSync(temp,'wx',0o600));if(process.platform==='win32')windowsAcl(temp,true);check(temp);fs.writeFileSync(temp,JSON.stringify(value),{encoding:'utf8',mode:0o600});fs.renameSync(temp,file);check(file);}catch(error){if(fs.existsSync(temp))fs.unlinkSync(temp);throw new Error('Could not securely save connector credentials',{cause:error});}
}
function loadCredentials(file){check(file);const value=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof value.baseUrl!=='string'||typeof value.token!=='string'||value.token.length<40||typeof value.nodeId!=='string')throw new Error('Invalid connector credentials');require('./agent-client.cjs').validateBaseUrl(value.baseUrl);require('./pairing.cjs').bindingFromPairing(value,{workspaceId:value.workspaceId});return value;}
module.exports={saveCredentials,loadCredentials};
