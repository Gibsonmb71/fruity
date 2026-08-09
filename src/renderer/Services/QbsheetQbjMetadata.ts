/** The non-secret QBJ source metadata written by QBSheet. */
import { portableResultFingerprint, readSourceMetadata, type IQbjSourceMetadata } from 'qbsheet';

export const qbsheetSourceExtensionKey = '_qbsheet_source';
export type IQbsheetQbjSourceMetadata = IQbjSourceMetadata;

/** Read the QBSheet metadata block, including legacy pre-QBSheet files. */
export function readQbsheetSourceMetadata(value: unknown): IQbsheetQbjSourceMetadata | null {
  return readSourceMetadata(value);
}

/** Use QBSheet's canonical portable-result fingerprint for backup reconciliation. */
export function qbsheetResultFingerprint(value: unknown): string {
  return portableResultFingerprint(value as object);
}
