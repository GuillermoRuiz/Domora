/** Storage keys stay server-side; list and upload expose the same metadata. */
export const DIRECT_MESSAGE_ATTACHMENT_SELECT = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
} as const;
