/**
 * Tests for ArgumentGraph
 * Part of Phase 7A Week 3: Group Decision & Collaboration System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ArgumentGraph, ArgumentPosition, EvidenceType } from '../../../src/memory/graph/argument-graph';
import { InMemoryGraphStorage } from '../../../src/memory/graph/in-memory-storage';
import { LamportClock } from '../../../src/timing/lamport-clock';

describe('ArgumentGraph', () => {
  let graph: ArgumentGraph;
  let storage: InMemoryGraphStorage;
  let clock: LamportClock;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    clock = new LamportClock('test-node');
    graph = new ArgumentGraph('test-actor', storage, clock);
  });

  describe('Topic Management', () => {
    it('should create a new argument topic', async () => {
      const topicId = await graph.createTopic({
        title: 'Should we approve this loan?',
        description: 'Discussion about loan application #12345'
      });

      expect(topicId).toMatch(/^topic_/);

      const topic = await graph.getTopic(topicId);
      expect(topic).toBeDefined();
      expect(topic!.title).toBe('Should we approve this loan?');
      expect(topic!.status).toBe('open');
      expect(topic!.createdBy).toBe('test-actor');
    });

    it('should create topic with metadata', async () => {
      const topicId = await graph.createTopic({
        title: 'Loan Approval',
        description: 'Review loan application',
        metadata: { loanId: '12345', amount: 50000 }
      });

      const topic = await graph.getTopic(topicId);
      expect(topic!.metadata).toEqual({ loanId: '12345', amount: 50000 });
    });

    it('should close a topic', async () => {
      const topicId = await graph.createTopic({
        title: 'Test Topic',
        description: 'Test'
      });

      await graph.closeTopic(topicId);

      const topic = await graph.getTopic(topicId);
      expect(topic!.status).toBe('closed');
    });
  });

  describe('Argument Submission', () => {
    let topicId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Loan Approval Decision',
        description: 'Should we approve loan #12345?'
      });
    });

    it('should submit a basic argument', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'The applicant has excellent credit history and stable income'
      );

      expect(argId).toMatch(/^arg_/);

      const argument = await graph.getArgument(argId);
      expect(argument).toBeDefined();
      expect(argument!.position).toBe('for');
      expect(argument!.authorId).toBe('test-actor');
      expect(argument!.topicId).toBe(topicId);
    });

    it('should submit argument with evidence', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'Strong financial position supports approval',
        {
          evidence: [
            {
              type: 'data',
              content: 'Credit score: 780',
              source: 'Credit Bureau',
              reliability: 0.95
            },
            {
              type: 'data',
              content: 'Annual income: $120,000',
              source: 'Tax Records',
              reliability: 0.98
            }
          ]
        }
      );

      const argument = await graph.getArgument(argId);
      expect(argument!.evidence).toHaveLength(2);
      expect(argument!.evidence[0].type).toBe('data');
      expect(argument!.evidence[0].reliability).toBe(0.95);
      expect(argument!.credibilityScore).toBeGreaterThan(0.5);
    });

    it('should submit supporting argument', async () => {
      const originalArgId = await graph.submitArgument(
        topicId,
        'for',
        'Applicant has good credit'
      );

      const supportingArgId = await graph.submitArgument(
        topicId,
        'for',
        'Previous loans all paid on time',
        { supportsArgumentId: originalArgId }
      );

      const supportingArg = await graph.getArgument(supportingArgId);
      expect(supportingArg!.supportsArgumentId).toBe(originalArgId);

      const supporting = await graph.getSupportingArguments(originalArgId);
      expect(supporting).toHaveLength(1);
      expect(supporting[0].id).toBe(supportingArgId);
    });

    it('should submit opposing argument', async () => {
      const originalArgId = await graph.submitArgument(
        topicId,
        'for',
        'Applicant has good income'
      );

      const opposingArgId = await graph.submitArgument(
        topicId,
        'against',
        'High debt-to-income ratio is concerning',
        { opposesArgumentId: originalArgId }
      );

      const opposingArg = await graph.getArgument(opposingArgId);
      expect(opposingArg!.opposesArgumentId).toBe(originalArgId);

      const opposing = await graph.getOpposingArguments(originalArgId);
      expect(opposing).toHaveLength(1);
      expect(opposing[0].id).toBe(opposingArgId);
    });

    it('should handle multiple arguments with different positions', async () => {
      await graph.submitArgument(topicId, 'for', 'Good credit history');
      await graph.submitArgument(topicId, 'for', 'Stable employment');
      await graph.submitArgument(topicId, 'against', 'High debt load');
      await graph.submitArgument(topicId, 'neutral', 'Need more information');

      const args = await graph.getTopicArguments(topicId);
      expect(args).toHaveLength(4);

      const forArgs = args.filter(a => a.position === 'for');
      const againstArgs = args.filter(a => a.position === 'against');
      const neutralArgs = args.filter(a => a.position === 'neutral');

      expect(forArgs).toHaveLength(2);
      expect(againstArgs).toHaveLength(1);
      expect(neutralArgs).toHaveLength(1);
    });
  });

  describe('Evidence Management', () => {
    let topicId: string;
    let argumentId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Test Topic',
        description: 'Test'
      });

      argumentId = await graph.submitArgument(
        topicId,
        'for',
        'Initial argument'
      );
    });

    it('should attach evidence to existing argument', async () => {
      const evidenceId = await graph.attachEvidence(argumentId, {
        type: 'data',
        content: 'Supporting data point',
        source: 'Database',
        reliability: 0.9
      });

      expect(evidenceId).toMatch(/^ev_/);

      const argument = await graph.getArgument(argumentId);
      expect(argument!.evidence).toHaveLength(1);
      expect(argument!.evidence[0].id).toBe(evidenceId);
    });

    it('should update credibility when adding evidence', async () => {
      const beforeArg = await graph.getArgument(argumentId);
      const beforeCredibility = beforeArg!.credibilityScore;

      await graph.attachEvidence(argumentId, {
        type: 'data',
        content: 'High quality evidence',
        source: 'Verified Source',
        reliability: 0.95
      });

      const afterArg = await graph.getArgument(argumentId);
      expect(afterArg!.credibilityScore).toBeGreaterThan(beforeCredibility);
    });

    it('should support multiple evidence types', async () => {
      await graph.attachEvidence(argumentId, {
        type: 'data',
        content: 'Statistical data',
        source: 'Research',
        reliability: 0.9
      });

      await graph.attachEvidence(argumentId, {
        type: 'precedent',
        content: 'Similar past case',
        source: 'Case Database',
        reliability: 0.85
      });

      await graph.attachEvidence(argumentId, {
        type: 'expert_opinion',
        content: 'Expert analysis',
        source: 'Domain Expert',
        reliability: 0.8
      });

      const argument = await graph.getArgument(argumentId);
      expect(argument!.evidence).toHaveLength(3);
      expect(argument!.evidence.map(e => e.type)).toEqual(['data', 'precedent', 'expert_opinion']);
    });
  });

  describe('Argument Quality Analysis', () => {
    let topicId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Quality Test',
        description: 'Test quality analysis'
      });
    });

    it('should analyze argument with no evidence', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'Basic argument without evidence'
      );

      const quality = await graph.analyzeArgumentQuality(argId);
      expect(quality.evidenceCount).toBe(0);
      expect(quality.averageReliability).toBe(0);
      expect(quality.hasCounterArguments).toBe(false);
    });

    it('should analyze argument with evidence', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'Well-supported argument',
        {
          evidence: [
            { type: 'data', content: 'Data 1', source: 'Source 1', reliability: 0.9 },
            { type: 'data', content: 'Data 2', source: 'Source 2', reliability: 0.8 }
          ]
        }
      );

      const quality = await graph.analyzeArgumentQuality(argId);
      expect(quality.evidenceCount).toBe(2);
      expect(quality.averageReliability).toBeCloseTo(0.85, 2);
      expect(quality.credibilityScore).toBeGreaterThan(0.5);
    });

    it('should detect counter-arguments in quality analysis', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'Original argument'
      );

      await graph.submitArgument(
        topicId,
        'against',
        'Counter argument',
        { opposesArgumentId: argId }
      );

      const quality = await graph.analyzeArgumentQuality(argId);
      expect(quality.hasCounterArguments).toBe(true);
      expect(quality.opposingArgumentCount).toBe(1);
    });

    it('should count supporting and opposing arguments', async () => {
      const argId = await graph.submitArgument(
        topicId,
        'for',
        'Main argument'
      );

      await graph.submitArgument(topicId, 'for', 'Support 1', { supportsArgumentId: argId });
      await graph.submitArgument(topicId, 'for', 'Support 2', { supportsArgumentId: argId });
      await graph.submitArgument(topicId, 'against', 'Oppose 1', { opposesArgumentId: argId });

      const quality = await graph.analyzeArgumentQuality(argId);
      expect(quality.supportingArgumentCount).toBe(2);
      expect(quality.opposingArgumentCount).toBe(1);
    });
  });

  describe('Consensus Analysis', () => {
    let topicId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Consensus Test',
        description: 'Test consensus analysis'
      });
    });

    it('should analyze empty topic', async () => {
      const consensus = await graph.analyzeConsensus(topicId);
      expect(consensus.totalArguments).toBe(0);
      expect(consensus.convergenceScore).toBe(0);
      expect(consensus.dominantPosition).toBe('none');
    });

    it('should detect strong consensus for position', async () => {
      await graph.submitArgument(topicId, 'for', 'Arg 1');
      await graph.submitArgument(topicId, 'for', 'Arg 2');
      await graph.submitArgument(topicId, 'for', 'Arg 3');
      await graph.submitArgument(topicId, 'against', 'Arg 4');

      const consensus = await graph.analyzeConsensus(topicId);
      expect(consensus.totalArguments).toBe(4);
      expect(consensus.forArguments).toBe(3);
      expect(consensus.againstArguments).toBe(1);
      expect(consensus.convergenceScore).toBe(0.75); // 3/4
      expect(consensus.dominantPosition).toBe('for');
    });

    it('should detect split opinion', async () => {
      await graph.submitArgument(topicId, 'for', 'Arg 1');
      await graph.submitArgument(topicId, 'for', 'Arg 2');
      await graph.submitArgument(topicId, 'against', 'Arg 3');
      await graph.submitArgument(topicId, 'against', 'Arg 4');

      const consensus = await graph.analyzeConsensus(topicId);
      expect(consensus.convergenceScore).toBe(0.5); // 2/4
      expect(consensus.dominantPosition).toBe('none'); // Tied
    });

    it('should calculate average credibility', async () => {
      await graph.submitArgument(topicId, 'for', 'High quality', {
        evidence: [{ type: 'data', content: 'Data', source: 'Source', reliability: 0.9 }]
      });
      await graph.submitArgument(topicId, 'for', 'Low quality'); // No evidence

      const consensus = await graph.analyzeConsensus(topicId);
      expect(consensus.averageCredibility).toBeGreaterThan(0);
      expect(consensus.averageCredibility).toBeLessThan(1);
    });
  });

  describe('Dissent Management', () => {
    let topicId: string;
    let argumentId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Dissent Test',
        description: 'Test dissent recording'
      });

      argumentId = await graph.submitArgument(
        topicId,
        'for',
        'Main argument'
      );
    });

    it('should record dissent', async () => {
      const dissentId = await graph.recordDissent(
        topicId,
        argumentId,
        'I disagree because of xyz'
      );

      expect(dissentId).toMatch(/^dissent_/);

      const dissents = await graph.getTopicDissents(topicId);
      expect(dissents).toHaveLength(1);
      expect(dissents[0].reason).toBe('I disagree because of xyz');
      expect(dissents[0].resolved).toBe(false);
    });

    it('should resolve dissent', async () => {
      const dissentId = await graph.recordDissent(
        topicId,
        argumentId,
        'My dissenting opinion'
      );

      await graph.resolveDissent(dissentId);

      const unresolved = await graph.getTopicDissents(topicId, false);
      expect(unresolved).toHaveLength(0);

      const all = await graph.getTopicDissents(topicId, true);
      expect(all).toHaveLength(1);
      expect(all[0].resolved).toBe(true);
      expect(all[0].resolvedAt).toBeDefined();
    });

    it('should track multiple dissents', async () => {
      await graph.recordDissent(topicId, argumentId, 'Dissent 1');
      await graph.recordDissent(topicId, argumentId, 'Dissent 2');
      await graph.recordDissent(topicId, argumentId, 'Dissent 3');

      const dissents = await graph.getTopicDissents(topicId);
      expect(dissents).toHaveLength(3);
    });
  });

  describe('Argument Chains', () => {
    let topicId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Chain Test',
        description: 'Test argument chains'
      });
    });

    it('should build argument chain with supporting arguments', async () => {
      const mainArgId = await graph.submitArgument(topicId, 'for', 'Main argument');
      const support1Id = await graph.submitArgument(topicId, 'for', 'Support 1', {
        supportsArgumentId: mainArgId
      });
      await graph.submitArgument(topicId, 'for', 'Support 2', {
        supportsArgumentId: support1Id
      });

      const chain = await graph.getArgumentChain(mainArgId);
      expect(chain.argument.id).toBe(mainArgId);
      expect(chain.supporting).toHaveLength(1);
      expect(chain.supporting[0].argument.id).toBe(support1Id);
      expect(chain.supporting[0].children).toHaveLength(1);
    });

    it('should build argument chain with opposing arguments', async () => {
      const mainArgId = await graph.submitArgument(topicId, 'for', 'Main argument');
      const oppose1Id = await graph.submitArgument(topicId, 'against', 'Oppose 1', {
        opposesArgumentId: mainArgId
      });

      const chain = await graph.getArgumentChain(mainArgId);
      expect(chain.opposing).toHaveLength(1);
      expect(chain.opposing[0].argument.id).toBe(oppose1Id);
    });

    it('should respect depth limit in chain building', async () => {
      const arg1 = await graph.submitArgument(topicId, 'for', 'Level 1');
      const arg2 = await graph.submitArgument(topicId, 'for', 'Level 2', {
        supportsArgumentId: arg1
      });
      const arg3 = await graph.submitArgument(topicId, 'for', 'Level 3', {
        supportsArgumentId: arg2
      });
      await graph.submitArgument(topicId, 'for', 'Level 4', {
        supportsArgumentId: arg3
      });

      const chain = await graph.getArgumentChain(arg1, 2);
      expect(chain.supporting).toHaveLength(1);
      expect(chain.supporting[0].children).toHaveLength(1);
      // Should not go to level 4 due to depth=2
    });
  });

  describe('Credibility Scoring', () => {
    let topicId: string;

    beforeEach(async () => {
      topicId = await graph.createTopic({
        title: 'Credibility Test',
        description: 'Test credibility scoring'
      });
    });

    it('should assign base credibility without evidence', async () => {
      const argId = await graph.submitArgument(topicId, 'for', 'No evidence');
      const arg = await graph.getArgument(argId);
      expect(arg!.credibilityScore).toBe(0.3); // Base score
    });

    it('should increase credibility with high-quality evidence', async () => {
      const argId = await graph.submitArgument(topicId, 'for', 'With evidence', {
        evidence: [
          { type: 'data', content: 'Data', source: 'Source', reliability: 0.95 },
          { type: 'data', content: 'Data', source: 'Source', reliability: 0.90 }
        ]
      });

      const arg = await graph.getArgument(argId);
      expect(arg!.credibilityScore).toBeGreaterThan(0.6);
    });

    it('should cap credibility at 1.0', async () => {
      const argId = await graph.submitArgument(topicId, 'for', 'Many evidences', {
        evidence: Array(10).fill(null).map(() => ({
          type: 'data' as EvidenceType,
          content: 'Perfect evidence',
          source: 'Source',
          reliability: 1.0
        }))
      });

      const arg = await graph.getArgument(argId);
      expect(arg!.credibilityScore).toBeLessThanOrEqual(1.0);
    });

    it('should reflect evidence quality in credibility', async () => {
      const highQualityArgId = await graph.submitArgument(topicId, 'for', 'High quality', {
        evidence: [{ type: 'data', content: 'Data', source: 'Source', reliability: 0.9 }]
      });

      const lowQualityArgId = await graph.submitArgument(topicId, 'for', 'Low quality', {
        evidence: [{ type: 'data', content: 'Data', source: 'Source', reliability: 0.3 }]
      });

      const highQualityArg = await graph.getArgument(highQualityArgId);
      const lowQualityArg = await graph.getArgument(lowQualityArgId);

      expect(highQualityArg!.credibilityScore).toBeGreaterThan(lowQualityArg!.credibilityScore);
    });
  });
});
