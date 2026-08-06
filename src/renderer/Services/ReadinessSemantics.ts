/** Small shared vocabulary for readiness UI. A checkmark is reserved for a verified fact. */
export type ReadinessStatus = 'verified' | 'problem' | 'unknown';

export interface IReadinessSemanticItem {
  status: ReadinessStatus;
  text: string;
}

export function readinessStatus(isVerified: boolean, hasProblem = false): ReadinessStatus {
  if (hasProblem) return 'problem';
  return isVerified ? 'verified' : 'unknown';
}
