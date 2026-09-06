import { File, UploadType } from "expo-file-system";

export type SignedUploadRequest = {
  url: string;
  headers: Readonly<Record<string, string>>;
  fileUri: string;
};

export type SignedUploadResult = { status: number };

/**
 * Sends the recording straight to private storage with the server's one-time authorization. No
 * bearer token is attached, and the response body is discarded so a signed URL or provider error
 * payload never reaches a log or the screen (AGENTS.md, personal information).
 */
export async function uploadToSignedUrl({
  url,
  headers,
  fileUri,
}: SignedUploadRequest): Promise<SignedUploadResult> {
  const file = new File(fileUri);
  if (!file.exists) throw new Error("The recording is no longer on this device.");

  const result = await file.upload(url, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { ...headers },
  });
  return { status: result.status };
}
