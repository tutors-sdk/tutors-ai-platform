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
  FakeToolHost,
  InMemoryToolAudit,
  KIT_CHANGED_ECHO_DESCRIPTION,
  KIT_SERVER,
  KIT_TOOLS,
  toolAuditContract,
  toolHostContract,
  type FakeTool,
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

const SLOW_MS = 200;

function kitTools(echoDescription: string = KIT_TOOLS.echo.description): FakeTool[] {
  const text = (args: Readonly<Record<string, unknown>>) => String(args['text']);
  return [
    { ...KIT_TOOLS.echo, description: echoDescription, run: (args) => ({ text: text(args) }) },
    { ...KIT_TOOLS.fail, run: (args) => ({ text: `failed: ${text(args)}`, isError: true }) },
    { ...KIT_TOOLS.mixed, run: () => ({ text: 'first\nsecond', omittedParts: 1 }) },
    { ...KIT_TOOLS.slow, latencyMs: SLOW_MS, run: () => ({ text: 'late' }) },
    { ...KIT_TOOLS.write, run: () => ({ text: 'written' }) },
  ];
}

toolHostContract('FakeToolHost', {
  working: () => new FakeToolHost({ [KIT_SERVER]: kitTools() }),
  changed: () => new FakeToolHost({ [KIT_SERVER]: kitTools(KIT_CHANGED_ECHO_DESCRIPTION) }),
  unreachable: () => {
    const host = new FakeToolHost({ [KIT_SERVER]: kitTools() });
    host.down.add(KIT_SERVER);
    return host;
  },
  slowerThanMs: SLOW_MS,
});

toolAuditContract('InMemoryToolAudit', { audit: () => new InMemoryToolAudit() });
