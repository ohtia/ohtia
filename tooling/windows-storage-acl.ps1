param(
    [Parameter(Mandatory)][ValidateSet('deny', 'restore')][string]$Action,
    [Parameter(Mandatory)][string]$Directory,
    [Parameter(Mandatory)][string]$Backup
)

$ErrorActionPreference = 'Stop'
$sections = [Security.AccessControl.AccessControlSections]::Access
$acl = [IO.Directory]::GetAccessControl($Directory, $sections)

if ($Action -eq 'deny') {
    $pending = "$Backup.pending"
    [IO.File]::WriteAllBytes($pending, $acl.GetSecurityDescriptorBinaryForm())
    [IO.File]::Move($pending, $Backup)

    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
        [Security.AccessControl.FileSystemRights]::ListDirectory,
        [Security.AccessControl.AccessControlType]::Deny
    )
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($Directory, $acl)
    return
}

$original = [IO.File]::ReadAllBytes($Backup)
$acl.SetSecurityDescriptorBinaryForm($original, $sections)
[IO.Directory]::SetAccessControl($Directory, $acl)

$expected = [Security.AccessControl.RawSecurityDescriptor]::new($original, 0)
$actual = [IO.Directory]::GetAccessControl($Directory, $sections)
$normalize = {
    param($sddl)
    # NTFS can record that it applied automatic inheritance when writing the same rules.
    [regex]::Replace($sddl, '^D:[^()]*', { param($flags) $flags.Value.Replace('AI', '') })
}
if ((& $normalize ($expected.GetSddlForm($sections))) -cne
    (& $normalize ($actual.GetSecurityDescriptorSddlForm($sections)))) {
    throw 'The fixture must restore the original Windows access rules.'
}
