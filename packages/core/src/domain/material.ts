/** A piece of course material retrieved for grounding. */
export interface Material {
  readonly id: string;
  readonly courseId: string;
  readonly topicId?: string;
  readonly labId?: string;
  readonly title: string;
  readonly text: string;
}

/** What a question is about, named in course terms. */
export interface MaterialQuery {
  readonly courseId: string;
  readonly topicId?: string;
  readonly labId?: string;
  /** Free text used for ranking; adapters decide how. */
  readonly text: string;
  readonly limit: number;
}
