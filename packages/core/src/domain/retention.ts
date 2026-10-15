import type { MemoryScopeKind } from './capability.ts';

/** A scope kind that something can actually be kept for. */
export type RetentionKind = Exclude<MemoryScopeKind, 'none'>;

/**
 * The moment some retained data ends. A session boundary ends `session`
 * retention for that session; a course boundary ends `session` and `course`
 * retention for that course; a learner boundary is an erasure request and
 * ends everything for that learner (docs/adr/0004).
 */
export type RetentionBoundary =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'course'; readonly courseId: string }
  | { readonly kind: 'learner'; readonly learnerId: string };

/** Whether data kept for `retention`, in this session and course, ends at `boundary`. Nothing is kept for `none`, so only erasure reaches it. */
export function endsAt(
  boundary: RetentionBoundary,
  data: { readonly retention: MemoryScopeKind; readonly learnerId: string; readonly sessionId: string; readonly courseId: string },
): boolean {
  switch (boundary.kind) {
    case 'session':
      return data.retention === 'session' && data.sessionId === boundary.sessionId;
    case 'course':
      return (data.retention === 'session' || data.retention === 'course') && data.courseId === boundary.courseId;
    case 'learner':
      return data.learnerId === boundary.learnerId;
  }
}
