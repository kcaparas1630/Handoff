// The caller's own record. The only self-service profile write is recording which version of the
// processing notice they accepted, which architecture §9 requires before voice is first enabled.
import { identityRepository, withIdentityTransaction } from "@handoff/db";
import type { SelfUserDto, UpdateSelfRequest } from "@handoff/contracts";
import { ApiHttpError } from "../http/errors";
import { decryptUserProfile } from "../security/profile-fields";
import type { ServiceDeps } from "../types/runtime";

export async function updateSelf({
  deps,
  actorUserId,
  input,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  input: UpdateSelfRequest;
}): Promise<SelfUserDto> {
  const user = await withIdentityTransaction(deps.db, { userId: actorUserId }, async (tx) => {
    const updated = await identityRepository.updateProcessingNotice(tx, {
      userId: actorUserId,
      processingNoticeVersion: input.processingNoticeVersion,
      acceptedAt: deps.now(),
    });
    return updated;
  });
  if (user === null) throw ApiHttpError.notFound("That account is not available");

  return {
    id: user.id,
    clerkUserId: user.clerkUserId,
    // The caller is this subject, so their own profile is the always-permitted decrypt.
    displayName: await decryptUserProfile(deps.keys, user.id, user.profileCiphertext),
    processingNoticeVersion: user.processingNoticeVersion,
  };
}
