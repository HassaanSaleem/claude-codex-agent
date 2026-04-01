import { describe, it, expect } from 'vitest';
import { isLikelyTask } from '../../src/utils/taskClassifier.js';

describe('isLikelyTask', () => {
  describe('greetings → false', () => {
    it.each([
      'hi',
      'hey',
      'hello',
      'howdy',
      'yo',
      'sup',
      'hiya',
      'good morning',
      'good afternoon',
      'good evening',
      'what\'s up',
      'whats up',
      'greetings',
      'Hello there',
      'Hey!',
    ])('"%s" is not a task', (text) => {
      expect(isLikelyTask(text)).toBe(false);
    });
  });

  describe('thanks / acknowledgments → false', () => {
    it.each([
      'thanks',
      'thank you',
      'thx',
      'ty',
      'cheers',
      'much appreciated',
      'great',
      'nice',
      'cool',
      'awesome',
      'perfect',
      'ok',
      'okay',
      'got it',
      'sounds good',
      'noted',
      'understood',
      'will do',
      'Thanks!',
      'Great.',
    ])('"%s" is not a task', (text) => {
      expect(isLikelyTask(text)).toBe(false);
    });
  });

  describe('short non-actionable messages → false', () => {
    it.each([
      'yes',
      'no',
      'maybe',
      'hmm',
      'lol',
      'wow',
      'oh',
      'I see',
      'not sure',
    ])('"%s" is not a task', (text) => {
      expect(isLikelyTask(text)).toBe(false);
    });
  });

  describe('simple questions (no task intent) → false', () => {
    it.each([
      'what does this do?',
      'how does this work?',
      'where is the config?',
      'why is this failing?',
      'is this correct?',
      'what is React?',
      'who wrote this?',
    ])('"%s" is not a task', (text) => {
      expect(isLikelyTask(text)).toBe(false);
    });
  });

  describe('task descriptions → true', () => {
    it.each([
      'add user authentication',
      'fix the login bug',
      'refactor the payment module to use async',
      'create a new component for the dashboard',
      'implement dark mode',
      'update the error handling',
      'remove the deprecated API',
      'write unit tests for the auth service',
      'optimize the database queries',
      'build a REST API for user management',
      'deploy the application to staging',
      'configure the CI/CD pipeline',
      'install the lodash dependency',
      'rename the UserService class',
      'move the utils to a shared package',
      'merge the feature branch',
      'replace axios with fetch',
      'generate types from the schema',
      'integrate Stripe payments',
      'enable caching for API responses',
    ])('"%s" is a task', (text) => {
      expect(isLikelyTask(text)).toBe(true);
    });
  });

  describe('task intent phrasing → true', () => {
    it.each([
      'can you add a login page?',
      'could you fix the styling issue?',
      'please refactor this component',
      'I need a new endpoint for users',
      'I want to add dark mode',
      'we need to update the schema',
      'we should migrate to TypeScript',
      "let's add error handling",
      'go ahead and deploy it',
    ])('"%s" is a task', (text) => {
      expect(isLikelyTask(text)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('empty string → false', () => {
      expect(isLikelyTask('')).toBe(false);
    });

    it('whitespace only → false', () => {
      expect(isLikelyTask('   ')).toBe(false);
    });

    it('single task verb → true', () => {
      expect(isLikelyTask('fix')).toBe(true);
    });

    it('longer messages default to task (conservative)', () => {
      expect(isLikelyTask('the authentication system has some problems with token refresh and session expiry')).toBe(true);
    });

    it('question with task verb → true', () => {
      expect(isLikelyTask('can you add a logout button to the nav?')).toBe(true);
    });
  });
});
