import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { PasskeyManager } from '../src/core/PasskeyManager';

// WebAuthn authenticatorData flag bits
const UP = 0x01; // user present
const UV = 0x04; // user verified
const BE = 0x08; // backup eligible  -> credential is syncable
const BS = 0x10; // backup state     -> credential is currently synced
const AT = 0x40; // attested credential data present (aaguid follows)

/**
 * Build synthetic authenticatorData:
 *   rpIdHash (32) | flags (1) | signCount (4) | [aaguid (16) when AT is set]
 */
function makeAuthData(flags: number, aaguid?: Uint8Array): Uint8Array {
  const data = new Uint8Array(37 + (aaguid ? 16 : 0));
  data[32] = flags;
  if (aaguid) data.set(aaguid, 37);
  return data;
}

describe('PasskeyManager.deriveAssurance', () => {
  it('classifies a non-backup-eligible credential as device-bound', () => {
    const assurance = PasskeyManager.deriveAssurance(makeAuthData(UP | UV));

    expect(assurance).not.toBeNull();
    expect(assurance!.level).toBe('device-bound');
    expect(assurance!.backupEligible).toBe(false);
    expect(assurance!.backupState).toBe(false);
    expect(assurance!.userVerified).toBe(true);
  });

  it('classifies a backup-eligible, synced credential as synced', () => {
    const assurance = PasskeyManager.deriveAssurance(makeAuthData(UP | UV | BE | BS));

    expect(assurance!.level).toBe('synced');
    expect(assurance!.backupEligible).toBe(true);
    expect(assurance!.backupState).toBe(true);
  });

  it('treats backup-eligible-but-not-yet-synced as synced (BE is the authority signal)', () => {
    const assurance = PasskeyManager.deriveAssurance(makeAuthData(UP | UV | BE));

    expect(assurance!.level).toBe('synced');
    expect(assurance!.backupEligible).toBe(true);
    expect(assurance!.backupState).toBe(false);
  });

  it('classifies a hardware key as device-bound regardless of host platform', () => {
    // The regression this guards: the old platform heuristic inferred "apple => synced",
    // which misclassifies a YubiKey plugged into a Mac. BE=0 is authoritative.
    const yubikey = makeAuthData(UP | UV, new Uint8Array(16).fill(0xab));
    const assurance = PasskeyManager.deriveAssurance(yubikey);

    expect(assurance!.level).toBe('device-bound');
    expect(assurance!.backupEligible).toBe(false);
  });

  it('extracts the AAGUID when attested credential data is present', () => {
    const aaguid = new Uint8Array(16).fill(0xab);
    const assurance = PasskeyManager.deriveAssurance(makeAuthData(UP | UV | BE | BS | AT, aaguid));

    expect(assurance!.aaguid).toBe(`0x${'ab'.repeat(16)}`);
  });

  it('omits the AAGUID when the AT flag is not set', () => {
    const assurance = PasskeyManager.deriveAssurance(makeAuthData(UP | UV | BE));
    expect(assurance!.aaguid).toBeUndefined();
  });

  it('returns null for authenticator data that is too short to be valid', () => {
    expect(PasskeyManager.deriveAssurance(new Uint8Array(36))).toBeNull();
  });
});

describe('PasskeyManager.parseBackupFlags (hex, backward compatible)', () => {
  it('reports BE/BS from a hex-encoded authenticatorData', () => {
    const hex = ethers.hexlify(makeAuthData(UP | UV | BE | BS));
    expect(PasskeyManager.parseBackupFlags(hex)).toEqual({
      backupEligible: true,
      backupState: true,
    });
  });

  it('reports both flags false for a device-bound credential', () => {
    const hex = ethers.hexlify(makeAuthData(UP | UV));
    expect(PasskeyManager.parseBackupFlags(hex)).toEqual({
      backupEligible: false,
      backupState: false,
    });
  });

  it('returns null on malformed input', () => {
    expect(PasskeyManager.parseBackupFlags('not-hex')).toBeNull();
  });
});
