---
type: Playbook
title: Release signing key
description: Choose or add the signing-only subkey, publish the public key, create the protected release-signing environment, export the subkey to it, and renew, revoke and recover the subkey without changing the primary identity.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
---

# Release signing key

[ADR-0050](adr/adr-0050-signed-linux-repositories-and-update-notices.md) owns the signing decision and [SPEC-001-037](epics/EPIC-001-desktop-foundation/epic.md#spec-001-037-linux-signing-identity-and-custody) its custody rules. The `Sign the RPM packages` job of [Release preparation](release-preparation.md#sign-the-rpm-packages) signs the RPM packages with a signing-only subkey of the maintainer's OpenPGP key. This procedure is run by the maintainer, on their own machine, with GnuPG 2.4 or later and `gh` authenticated as described in [Repository policy](repository-policy.md#authentication). No command sends the primary key's secret anywhere.

## What is kept where

- The primary key and its revocation certificate stay offline in the maintainer's GnuPG directory, with an offline backup. The primary key only certifies: it adds, renews and revokes subkeys.
- The signing subkey is one signing-only subkey, valid for one year. Its secret, protected with a passphrase of its own, is stored as the secret `SIGNING_SUBKEY` of the GitHub environment `release-signing`, and that passphrase as the secret `SIGNING_PASSPHRASE`. GitHub gives them only to a job of that environment, only for a run from `main` and only after the maintainer approves it.
- The public key is committed as [`config/release/signing-key.asc`](../config/release/signing-key.asc), and its primary fingerprint as the record [`config/release/signing.json`](../config/release/signing.json). The signing job refuses a subkey that does not belong to that fingerprint, an export that holds the primary key's secret, and an expired or revoked subkey. Anyone who reads the repository sees the user IDs of the public key, such as its name and email address.

## Prepare the GnuPG directory

Every `gpg` command below names the GnuPG directory that holds the release signing key with `--homedir`, so no command reads or changes another key ring, such as a personal one. In each new terminal, store the path of that directory in a shell variable, replacing `<signing-gnupg-directory>` with it:

```bash
signing_gnupg=<signing-gnupg-directory>
```

List the key. The 40-character line after `sec` is the primary fingerprint; use it as `<primary-fingerprint>`. Each `ssb` line is a subkey, followed by its fingerprint; `[S]` marks a signing subkey, and `expires:` its expiry date:

```bash
gpg --homedir "$signing_gnupg" --list-secret-keys --with-subkey-fingerprints
```

## Choose the signing subkey

When the list shows a signing subkey, marked `[S]`, that has not expired, use its fingerprint as `<subkey-fingerprint>` and continue with [Publish the public key](#publish-the-public-key). Otherwise add a signing-only subkey valid for one year. GnuPG asks for the primary key's passphrase:

```bash
gpg --homedir "$signing_gnupg" --quick-add-key <primary-fingerprint> ed25519 sign 1y
```

List the subkeys. The new subkey is the `sub` line marked `[S]` with the latest creation date; the 40-character line below it is its fingerprint; use it as `<subkey-fingerprint>`:

```bash
gpg --homedir "$signing_gnupg" --list-keys --with-subkey-fingerprints <primary-fingerprint>
```

## Publish the public key

In a checkout of the repository, on a task branch, write the public key and the record of its primary fingerprint, then integrate them into `main` through a pull request. The signing job reads both files from `main`:

```bash
gpg --homedir "$signing_gnupg" --armor --export-options export-minimal --export <primary-fingerprint> > config/release/signing-key.asc
printf '{\n  "schema_version": 1,\n  "fingerprint": "%s"\n}\n' <primary-fingerprint> > config/release/signing.json
```

The fingerprint in `signing.json` uses the 40 uppercase hexadecimal characters that `gpg` prints, without spaces.

## Create the release-signing environment

Create the environment before running the workflow: a run that references a missing environment creates it without protection rules. On GitHub, open the repository **Settings**, select **Environments** and **New environment**, enter `release-signing` and select **Configure environment**. Then:

1. Select **Required reviewers**, add your own account and leave **Prevent self-review** unselected, because you approve the runs you start. Select **Save protection rules**.
2. Deselect **Allow administrators to bypass configured protection rules** and select **Save protection rules**.
3. In **Deployment branches**, select **Selected branches and tags**, then **Add deployment branch or tag rule**. Select the ref type **Branch**, enter `main` and select **Add rule**.

Read the environment back. The first command prints `can_admins_bypass` set to `false`, a `deployment_branch_policy` with `custom_branch_policies` set to `true` and `protected_branches` set to `false`, a `required_reviewers` rule naming your account with `prevent_self_review` set to `false`, and a `branch_policy` rule; the second prints the only allowed ref, `main` of type `branch`:

```bash
gh api repos/ohtia/ohtia/environments/release-signing --jq '{can_admins_bypass, deployment_branch_policy, protection_rules: [.protection_rules[] | {type, prevent_self_review, reviewers: [.reviewers[]?.reviewer.login]}]}'
gh api repos/ohtia/ohtia/environments/release-signing/deployment-branch-policies --jq '[.branch_policies[] | {name, type}]'
```

## Export the subkey to the environment

Export only the signing subkey into a new temporary directory and give that copy a passphrase of its own, so the secret stored on GitHub never reveals the primary key's passphrase. Use a long passphrase that protects nothing else; it is needed only until it is stored as a secret.

1. Export the subkey; GnuPG asks for the primary key's passphrase. The `!` after the fingerprint exports that subkey alone:

   ```bash
   transfer=$(mktemp -d)
   gpg --homedir "$signing_gnupg" --armor --export-secret-subkeys '<subkey-fingerprint>!' > "$transfer/subkey.asc"
   ```

2. Import the copy into a separate GnuPG directory and change its passphrase. GnuPG first reports `error changing passphrase: No secret key` for the primary key, which the copy does not hold, then asks in a passphrase window for the current passphrase of the subkey and for the new one. The window closes by itself when nobody answers; GnuPG then reports `error changing passphrase: Timeout` for the subkey and changes nothing, and the command can be repeated. A change that succeeds reports no error for the subkey; GnuPG still prints `Key not changed so no update needed`, because the passphrase is not stored in the key ring:

   ```bash
   mkdir -m 700 "$transfer/gnupg"
   gpg --homedir "$transfer/gnupg" --import "$transfer/subkey.asc"
   gpg --homedir "$transfer/gnupg" --edit-key <primary-fingerprint> passwd save
   ```

   Check the new passphrase. The first command stops the copy's GnuPG agent, so it forgets every passphrase; the second signs a test text with the copy and asks for the passphrase again. Enter the new one; the command prints `signed` only when it works:

   ```bash
   gpgconf --homedir "$transfer/gnupg" --kill gpg-agent
   echo test | gpg --homedir "$transfer/gnupg" --local-user '<subkey-fingerprint>!' --clearsign > /dev/null && echo signed
   ```

3. Export the copy with its new passphrase and store it and the passphrase as the environment secrets. The second `gh secret set` asks for the new passphrase without showing it:

   ```bash
   gpg --homedir "$transfer/gnupg" --armor --export-secret-subkeys '<subkey-fingerprint>!' > "$transfer/release-subkey.asc"
   gh secret set SIGNING_SUBKEY --env release-signing --repo ohtia/ohtia < "$transfer/release-subkey.asc"
   gh secret set SIGNING_PASSPHRASE --env release-signing --repo ohtia/ohtia
   ```

4. Delete the temporary copies and list the secrets, which shows their names and update times, never their values:

   ```bash
   gpgconf --homedir "$transfer/gnupg" --kill all
   rm -rf "$transfer"
   gh secret list --env release-signing --repo ohtia/ohtia
   ```

## Renew the subkey

Renew the subkey every year, before the expiry date that `gpg --homedir "$signing_gnupg" --list-keys --with-subkey-fingerprints <primary-fingerprint>` prints after `expires:`. An expired subkey can also be renewed; until then the signing job refuses it. Extend it by one year from today; GnuPG asks for the primary key's passphrase:

```bash
gpg --homedir "$signing_gnupg" --quick-set-expire <primary-fingerprint> 1y <subkey-fingerprint>
```

The new expiry is part of the public key and of the exported subkey, so repeat [Publish the public key](#publish-the-public-key) and [Export the subkey to the environment](#export-the-subkey-to-the-environment). The primary identity and the subkey stay the same.

The primary key may have an expiry date of its own, printed after `expires:` on its `sec` line; when it expires, its subkeys stop being valid too. Extend it before that date, then repeat [Publish the public key](#publish-the-public-key):

```bash
gpg --homedir "$signing_gnupg" --quick-set-expire <primary-fingerprint> 2y
```

## Revoke the subkey

Revoke the subkey when its secret or passphrase may be exposed, or when it is replaced. Open the key, select the subkey by its fingerprint, revoke it, give the reason and save; GnuPG asks for the primary key's passphrase:

```bash
gpg --homedir "$signing_gnupg" --edit-key <primary-fingerprint>
```

```text
gpg> key <subkey-fingerprint>
gpg> revkey
gpg> save
```

Remove the environment secrets, so no run can sign with the revoked subkey:

```bash
gh secret delete SIGNING_SUBKEY --env release-signing --repo ohtia/ohtia
gh secret delete SIGNING_PASSPHRASE --env release-signing --repo ohtia/ohtia
```

Then [add a new signing subkey](#choose-the-signing-subkey), [publish the public key](#publish-the-public-key), which now carries the revocation and the new subkey, and [export the new subkey to the environment](#export-the-subkey-to-the-environment). The signing job refuses the revoked subkey. The primary identity stays the same.

## Recover

- **Lost or replaced environment secrets.** The subkey is still in the maintainer's GnuPG directory: repeat [Export the subkey to the environment](#export-the-subkey-to-the-environment).
- **Lost GnuPG directory.** Restore it from the offline backup. Keep that backup, with the revocation certificate, on offline media, and update it after every change to the key.
- **Lost or exposed primary key.** The primary key alone renews and revokes subkeys, and installed systems trust its identity. Revoke the whole key with its revocation certificate; replacing the identity requires a new decision, because systems that trust the old one must be told to trust the new one.
