import {
  aMaterial,
  courseContentContract,
  evidenceStoreContract,
  FakeLanguageModel,
  FixedClock,
  InMemoryCourseContent,
  InMemoryEvidenceStore,
  InMemoryInsightStore,
  insightStoreContract,
  InMemoryLearnerMemory,
  languageModelContract,
  learnerMemoryContract,
  policyProviderContract,
  StaticPolicyProvider,
  FIRST_YEAR,
  FINAL_YEAR,
} from '../src/index.ts';

// The fakes are adapters too: they pass the same kits as production adapters,
// which is what makes a use-case test against a fake mean something.

languageModelContract('FakeLanguageModel', {
  working: () => new FakeLanguageModel(),
  unreachable: () => new FakeLanguageModel({ unavailable: true }),
  slow: () => new FakeLanguageModel({ latencyMs: 200 }),
  slowerThanMs: 200,
});

courseContentContract('InMemoryCourseContent', {
  content: () =>
    new InMemoryCourseContent([
      aMaterial('c1-l1-a', { text: 'Open the lab and install Node.' }),
      aMaterial('c1-l1-b', { text: 'Write a while loop that counts to ten.' }),
      aMaterial('c1-l2-a', { labId: 'lab-2', text: 'Arrays in this lab.' }),
      aMaterial('c2-l1-a', { courseId: 'course-2', text: 'Another course lab.' }),
    ]),
  courseId: 'course-1',
  topicId: 'topic-1',
  labId: 'lab-1',
  otherCourseId: 'course-2',
  probe: { text: 'while loop counts', expectedFirstId: 'c1-l1-b' },
});

evidenceStoreContract('InMemoryEvidenceStore', { store: () => new InMemoryEvidenceStore(new FixedClock()) });

learnerMemoryContract('InMemoryLearnerMemory', { memory: () => new InMemoryLearnerMemory() });

policyProviderContract('StaticPolicyProvider', {
  provider: () => new StaticPolicyProvider([FIRST_YEAR, FINAL_YEAR]),
  courseId: 'course-1',
  levels: ['first-year', 'final-year'],
});

insightStoreContract('InMemoryInsightStore', { store: () => new InMemoryInsightStore() });
