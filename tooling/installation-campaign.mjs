import {
  catalogBytes,
  updateLimits,
  verifyCatalog,
  withAcceptanceState,
} from "./update-admission.mjs";
// Retained internal campaigns never replay an uncertain graphical mutation.
export function parseCampaignOptions(options) {
  const flags = new Set();
  let continueFrom, baseline;
  const signing = {};
  for (let i = 0; i < options.length; i++) {
    const flag = options[i];
    if (
      ![
        "--operator-installation",
        "--continue-from",
        "--resume",
        "--baseline",
        "--renew-catalogs",
        "--signed-catalogs",
        "--catalog-public-key",
        "--catalog-key-id",
      ].includes(flag) ||
      flags.has(flag)
    )
      throw new Error("Unknown or duplicate campaign option.");
    flags.add(flag);
    if (
      [
        "--continue-from",
        "--baseline",
        "--signed-catalogs",
        "--catalog-public-key",
        "--catalog-key-id",
      ].includes(flag)
    ) {
      const value = options[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`An explicit value is required for ${flag}.`);
      if (flag === "--continue-from") continueFrom = value;
      else if (flag === "--baseline") baseline = value;
      else signing[flag] = value;
    }
  }
  const resume = flags.has("--resume"),
    operator = flags.has("--operator-installation");
  const renew = flags.has("--renew-catalogs");
  if ((resume && (continueFrom || baseline)) || (baseline && continueFrom) || (renew && !resume))
    throw new Error("Resume one retained campaign or start from one inspected baseline.");
  const supplied = Object.keys(signing).length;
  if ((supplied !== 0 && supplied !== 3) || (supplied && renew))
    throw new Error(
      "Supply signed catalogs, public key and independent key ID together; external signing cannot renew ephemeral catalogs.",
    );
  return {
    resume,
    operator,
    continueFrom,
    baseline,
    renew,
    ...(supplied
      ? {
          externalSigning: {
            directory: signing["--signed-catalogs"],
            publicKey: signing["--catalog-public-key"],
            keyId: signing["--catalog-key-id"],
          },
        }
      : {}),
  };
}
export function assertCampaignSigning(campaign, external, retainedTrust) {
  const versions = campaign?.contracts?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 2 ||
    !Array.isArray(campaign.attempts) ||
    campaign.attempts.length !== versions.length ||
    !campaign.attempts.every(
      (planned, index) =>
        planned && planned.attempt === index + 1 && planned.version === versions[index],
    )
  )
    throw new Error("Retained campaign attempts differ from the complete sealed version order.");
  if (Boolean(campaign.signing) !== Boolean(external))
    throw new Error("Resume requires the original external signing mode.");
  if (!external) return;
  const expected = {
    kind: "external",
    key_id: external.key_id,
    request_sha256: external.request_sha256,
  };
  if (
    !catalogBytes(campaign.signing).equals(catalogBytes(expected)) ||
    !catalogBytes(retainedTrust).equals(catalogBytes(external.trust))
  )
    throw new Error(
      "Resume requires the original external request and independently pinned public key.",
    );
  if (
    campaign.attempts.some(
      (planned) =>
        planned.catalogName !== `catalog-${planned.attempt}.json` ||
        planned.signatureName !== `catalog-${planned.attempt}.sig`,
    )
  )
    throw new Error("Retained external campaign metadata changed.");
}

// Re-read retained state only after owning the same lease as native mutation.
export function withCampaignAcceptance(directory, fresh, context, operation, leaseDetails = {}) {
  if (leaseDetails.owner?.pid !== process.pid)
    throw new Error("Native lease owner differs from this controller process.");
  return withAcceptanceState(
    directory,
    fresh,
    async (previous, persist, lease) => {
      let retained = null;
      if (context.resume) {
        retained = context.readRetained();
        if (
          !catalogBytes(retained.campaign.inputs).equals(catalogBytes(context.inputs)) ||
          !catalogBytes(retained.campaign.contracts).equals(catalogBytes(context.contracts))
        )
          throw new Error("Retained campaign inputs changed.");
        assertCampaignSigning(retained.campaign, context.external, retained.trust);
      } else if (
        context.external &&
        JSON.parse(context.external.catalogs[0].bytes).sequence <= (previous?.sequence ?? 0)
      )
        throw new Error("External catalog sequence must advance the retained acceptance floor.");
      return operation(previous, persist, lease, retained);
    },
    leaseDetails,
  );
}

export function readCampaignSnapshot(read, planned, external, kind) {
  const signature = kind === "signature";
  const bytes = read(
    signature ? planned.signatureName : planned.catalogName,
    signature ? 64 : updateLimits.catalog_bytes,
  );
  if (
    external &&
    !bytes.equals(external.catalogs[planned.attempt - 1]?.[signature ? "signature" : "bytes"])
  )
    throw new Error(
      `Retained external ${signature ? "signature" : "catalog"} differs from the independently selected signed request.`,
    );
  return bytes;
}

// Historical authentication never supplies the clock for a pending native effect.
export function admitPendingCatalog(bytes, signature, trust, context) {
  return verifyCatalog(bytes, signature, trust, { ...context, now_ms: Date.now() });
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
