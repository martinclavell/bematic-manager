/**
 * Mock implementation of Slack client for testing purposes.
 * Provides Jest-compatible mock functions for all Slack API methods
 * used in the Bematic Manager system.
 *
 * @example
 * ```typescript
 * const mockSlack = new MockSlackClient();
 *
 * // Use in tests
 * mockSlack.postMessage.mockResolvedValue({ ok: true, ts: '1234567890.123456' });
 *
 * // Test your code
 * await yourService.sendMessage('Hello world');
 *
 * // Assert
 * expect(mockSlack.postMessage).toHaveBeenCalledWith({
 *   channel: 'C1234567890',
 *   text: 'Hello world'
 * });
 * ```
 */
export class MockSlackClient {
  /**
   * Mock for posting messages to channels
   */
  postMessage: jest.Mock = jest.fn();

  /**
   * Mock for adding reactions to messages
   */
  addReaction: jest.Mock = jest.fn();

  /**
   * Mock for removing reactions from messages
   */
  removeReaction: jest.Mock = jest.fn();

  /**
   * Mock for posting ephemeral messages (visible only to specific user)
   */
  postEphemeral: jest.Mock = jest.fn();

  /**
   * Mock for updating existing messages
   */
  updateMessage: jest.Mock = jest.fn();

  /**
   * Mock for deleting messages
   */
  deleteMessage: jest.Mock = jest.fn();

  /**
   * Mock for uploading files
   */
  uploadFile: jest.Mock = jest.fn();

  /**
   * Mock for getting user information
   */
  getUserInfo: jest.Mock = jest.fn();

  /**
   * Mock for getting channel information
   */
  getChannelInfo: jest.Mock = jest.fn();

  /**
   * Mock for getting conversation history
   */
  getConversationHistory: jest.Mock = jest.fn();

  /**
   * Mock for opening direct message channels
   */
  openDirectMessage: jest.Mock = jest.fn();

  /**
   * Mock for setting channel topic
   */
  setChannelTopic: jest.Mock = jest.fn();

  /**
   * Mock for inviting users to channels
   */
  inviteToChannel: jest.Mock = jest.fn();

  /**
   * Mock for kicking users from channels
   */
  kickFromChannel: jest.Mock = jest.fn();

  /**
   * Mock for getting bot information
   */
  getBotInfo: jest.Mock = jest.fn();

  /**
   * Mock for testing API connection
   */
  testAuth: jest.Mock = jest.fn();

  constructor() {
    this.setupDefaultImplementations();
  }

  /**
   * Set up default mock implementations that return successful responses
   */
  private setupDefaultImplementations(): void {
    // Default successful responses
    this.postMessage.mockResolvedValue({
      ok: true,
      ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`,
      message: {
        type: 'message',
        subtype: 'bot_message',
        text: 'Mock message',
        ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`,
        bot_id: 'B01234567890'
      }
    });

    this.addReaction.mockResolvedValue({ ok: true });
    this.removeReaction.mockResolvedValue({ ok: true });

    this.postEphemeral.mockResolvedValue({
      ok: true,
      message_ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`
    });

    this.updateMessage.mockResolvedValue({
      ok: true,
      ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`,
      text: 'Updated mock message'
    });

    this.deleteMessage.mockResolvedValue({
      ok: true,
      ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`
    });

    this.uploadFile.mockResolvedValue({
      ok: true,
      file: {
        id: `F${Math.random().toString(36).substring(2, 12).toUpperCase()}`,
        name: 'mock_file.txt',
        mimetype: 'text/plain',
        size: 1024
      }
    });

    this.getUserInfo.mockResolvedValue({
      ok: true,
      user: {
        id: 'U01234567890',
        name: 'testuser',
        real_name: 'Test User',
        profile: {
          email: 'test@example.com',
          display_name: 'Test User'
        }
      }
    });

    this.getChannelInfo.mockResolvedValue({
      ok: true,
      channel: {
        id: 'C01234567890',
        name: 'test-channel',
        is_channel: true,
        is_private: false,
        is_member: true
      }
    });

    this.getConversationHistory.mockResolvedValue({
      ok: true,
      messages: [],
      has_more: false
    });

    this.openDirectMessage.mockResolvedValue({
      ok: true,
      channel: {
        id: 'D01234567890'
      }
    });

    this.setChannelTopic.mockResolvedValue({
      ok: true,
      topic: 'Mock topic'
    });

    this.inviteToChannel.mockResolvedValue({
      ok: true,
      channel: {
        id: 'C01234567890'
      }
    });

    this.kickFromChannel.mockResolvedValue({ ok: true });

    this.getBotInfo.mockResolvedValue({
      ok: true,
      bot: {
        id: 'B01234567890',
        name: 'testbot',
        app_id: 'A01234567890'
      }
    });

    this.testAuth.mockResolvedValue({
      ok: true,
      user: 'testbot',
      team: 'Test Team',
      url: 'https://test.slack.com/',
      team_id: 'T01234567890',
      user_id: 'U01234567890'
    });
  }

  /**
   * Reset all mocks to their initial state
   */
  reset(): void {
    // Clear all mock calls and implementations
    const mockMethods = [
      'postMessage', 'addReaction', 'removeReaction', 'postEphemeral',
      'updateMessage', 'deleteMessage', 'uploadFile', 'getUserInfo',
      'getChannelInfo', 'getConversationHistory', 'openDirectMessage',
      'setChannelTopic', 'inviteToChannel', 'kickFromChannel',
      'getBotInfo', 'testAuth'
    ];

    mockMethods.forEach(method => {
      (this as any)[method].mockReset();
    });

    // Restore default implementations
    this.setupDefaultImplementations();
  }

  /**
   * Get the number of times a method was called
   * @param method Method name to check
   * @returns Number of calls
   */
  getCallCount(method: keyof MockSlackClient): number {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    return mockMethod.mock.calls.length;
  }

  /**
   * Get the last call arguments for a method
   * @param method Method name to check
   * @returns Last call arguments or undefined if never called
   */
  getLastCall(method: keyof MockSlackClient): any[] | undefined {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    const calls = mockMethod.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1] : undefined;
  }

  /**
   * Get all call arguments for a method
   * @param method Method name to check
   * @returns Array of all call arguments
   */
  getAllCalls(method: keyof MockSlackClient): any[][] {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    return mockMethod.mock.calls;
  }

  /**
   * Assert that a method was called with specific arguments
   * @param method Method name to check
   * @param expectedArgs Expected arguments
   */
  assertCalledWith(method: keyof MockSlackClient, ...expectedArgs: any[]): void {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    expect(mockMethod).toHaveBeenCalledWith(...expectedArgs);
  }

  /**
   * Assert that a method was called a specific number of times
   * @param method Method name to check
   * @param expectedCount Expected call count
   */
  assertCallCount(method: keyof MockSlackClient, expectedCount: number): void {
    const actualCount = this.getCallCount(method);
    expect(actualCount).toBe(expectedCount);
  }

  /**
   * Assert that a method was never called
   * @param method Method name to check
   */
  assertNotCalled(method: keyof MockSlackClient): void {
    this.assertCallCount(method, 0);
  }

  /**
   * Configure a method to return an error response
   * @param method Method name to configure
   * @param errorMessage Error message
   */
  mockError(method: keyof MockSlackClient, errorMessage = 'Mock error'): void {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    mockMethod.mockResolvedValue({
      ok: false,
      error: errorMessage
    });
  }

  /**
   * Configure a method to throw an exception
   * @param method Method name to configure
   * @param error Error to throw
   */
  mockThrow(method: keyof MockSlackClient, error: Error | string): void {
    const mockMethod = (this as any)[method];
    if (!mockMethod || !mockMethod.mock) {
      throw new Error(`Method '${method}' is not a mock function`);
    }
    mockMethod.mockRejectedValue(typeof error === 'string' ? new Error(error) : error);
  }

  /**
   * Configure postMessage to return a specific message timestamp
   * @param ts Message timestamp to return
   */
  mockMessageTimestamp(ts: string): void {
    this.postMessage.mockResolvedValue({
      ok: true,
      ts,
      message: {
        type: 'message',
        subtype: 'bot_message',
        text: 'Mock message',
        ts,
        bot_id: 'B01234567890'
      }
    });
  }

  /**
   * Configure getUserInfo to return specific user data
   * @param userId User ID
   * @param userData User data to return
   */
  mockUser(userId: string, userData: Partial<any> = {}): void {
    this.getUserInfo.mockResolvedValue({
      ok: true,
      user: {
        id: userId,
        name: 'testuser',
        real_name: 'Test User',
        profile: {
          email: 'test@example.com',
          display_name: 'Test User'
        },
        ...userData
      }
    });
  }

  /**
   * Configure getChannelInfo to return specific channel data
   * @param channelId Channel ID
   * @param channelData Channel data to return
   */
  mockChannel(channelId: string, channelData: Partial<any> = {}): void {
    this.getChannelInfo.mockResolvedValue({
      ok: true,
      channel: {
        id: channelId,
        name: 'test-channel',
        is_channel: true,
        is_private: false,
        is_member: true,
        ...channelData
      }
    });
  }

  /**
   * Get a summary of all method call counts
   * @returns Object with method names and call counts
   */
  getCallSummary(): Record<string, number> {
    const mockMethods = [
      'postMessage', 'addReaction', 'removeReaction', 'postEphemeral',
      'updateMessage', 'deleteMessage', 'uploadFile', 'getUserInfo',
      'getChannelInfo', 'getConversationHistory', 'openDirectMessage',
      'setChannelTopic', 'inviteToChannel', 'kickFromChannel',
      'getBotInfo', 'testAuth'
    ];

    const summary: Record<string, number> = {};
    mockMethods.forEach(method => {
      try {
        summary[method] = this.getCallCount(method as keyof MockSlackClient);
      } catch {
        summary[method] = 0;
      }
    });

    return summary;
  }
}