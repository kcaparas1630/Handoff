-- Milestone 4 adds the abandoned-upload and orphan-object sweep as its own job kind, so it can
-- be scheduled and retried independently of the audio retention sweep.
ALTER TYPE "handoff"."job_kind" ADD VALUE 'cleanup_uploads' BEFORE 'purge_child';
