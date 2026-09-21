import { generateToken } from "@/modules/shared/crypto";

export interface VerificationStart {
  provider: string;
  isMock: boolean;
  token: string;
  expiresAt: Date;
}

export interface VerificationProvider {
  readonly name: string;
  readonly isMock: boolean;
  start(userId: string): Promise<VerificationStart>;
}

/**
 * Mock verification is NOT identity verification. Users verified this way are
 * only ever eligible for the demo pool (see connection pool eligibility).
 */
export class MockVerificationProvider implements VerificationProvider {
  readonly name = "mock";
  readonly isMock = true;

  async start(): Promise<VerificationStart> {
    return {
      provider: this.name,
      isMock: true,
      token: generateToken(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}

let instance: VerificationProvider | null = null;

export function verificationProvider(): VerificationProvider {
  if (!instance) instance = new MockVerificationProvider();
  return instance;
}
