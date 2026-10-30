import { updateLimits } from "./update-admission.mjs";
// Retained internal campaigns never replay an uncertain graphical mutation.
export function parseCampaignOptions(options) {
  const flags = new Set();
  let continueFrom, baseline;
  for (let i = 0; i < options.length; i++) {
    const flag = options[i];
    if (
      ![
        "--operator-installation",
        "--continue-from",
        "--resume",
        "--baseline",
        "--renew-catalogs",
      ].includes(flag) ||
      flags.has(flag)
    )
      throw new Error("Unknown or duplicate campaign option.");
    flags.add(flag);
    if (["--continue-from", "--baseline"].includes(flag)) {
      const value = options[++i];
      if (!value || value.startsWith("--"))
        throw new Error("An explicit baseline/evidence path is required.");
      if (flag === "--continue-from") continueFrom = value;
      else baseline = value;
    }
  }
  const resume = flags.has("--resume"),
    operator = flags.has("--operator-installation");
  const renew = flags.has("--renew-catalogs");
  if ((resume && (continueFrom || baseline)) || (baseline && continueFrom) || (renew && !resume))
    throw new Error("Resume one retained campaign or start from one inspected baseline.");
  return { resume, operator, continueFrom, baseline, renew };
}
export function resumePolicy(attempts, confirmations, floorSequence, finalSequence) {
  if (floorSequence > finalSequence)
    throw new Error("A newer campaign superseded this retained operation.");
  let lastConfirmedAttempt = null,
    missing = false;
  for (const planned of attempts) {
    const confirmed = confirmations.get(planned.attempt);
    if (confirmed) {
      if (missing || confirmed.status !== "passed" || confirmed.package.version !== planned.version)
        throw new Error("Confirmed attempt changed or is out of order.");
      lastConfirmedAttempt = planned.attempt;
    } else {
      missing = true;
      if (["observing", "complete"].includes(planned.phase))
        throw new Error(
          "Interrupted graphical mutation has an uncertain outcome; no mutation is replayed.",
        );
    }
  }
  return { lastConfirmedAttempt, complete: !missing };
}

export function renewalCatalog(catalog, keyId, sequence, now) {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= catalog.sequence ||
    !Number.isSafeInteger(now) ||
    now <= 1000 ||
    now < catalog.issued_ms ||
    !Number.isSafeInteger(now + updateLimits.catalog_lifetime_ms)
  )
    throw new Error("Manual renewal must advance sequence and preserve clock certainty.");
  return {
    ...structuredClone(catalog),
    key_id: keyId,
    sequence,
    issued_ms: now - 1000,
    expires_ms: now + updateLimits.catalog_lifetime_ms - 1000,
  };
}

export function renewalTrust(trust, newKey, referencedIds = null) {
  const keys = [...trust.keys.filter((item) => item.id !== newKey.id), newKey];
  return { keys: referencedIds ? keys.filter((item) => referencedIds.has(item.id)) : keys };
}
