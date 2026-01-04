import type { Channel, ChannelMessage, PrivateMessage, User } from './chat-types';

/**
 * Mock users for the chat application
 */
export const MOCK_USERS: User[] = [
  { id: 'user1', name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 'user2', name: 'Bob Smith', email: 'bob@example.com' },
  { id: 'user3', name: 'Carol White', email: 'carol@example.com' },
  { id: 'user4', name: 'David Brown', email: 'david@example.com' },
  { id: 'user5', name: 'Eve Davis', email: 'eve@example.com' },
];

/**
 * Mock channels for the chat application
 */
export const MOCK_CHANNELS: Channel[] = [
  { id: 'channel1', name: 'general', description: 'General discussion' },
  { id: 'channel2', name: 'random', description: 'Random off-topic chat' },
  { id: 'channel3', name: 'announcements', description: 'Important announcements' },
  { id: 'channel4', name: 'projects', description: 'Project discussions' },
  { id: 'channel5', name: 'help', description: 'Help and support' },
];

/**
 * Mock private messages between users
 */
export const MOCK_PRIVATE_MESSAGES: PrivateMessage[] = [
  {
    id: 'msg1',
    from: 'user1',
    to: 'user2',
    text: 'Hey Bob, how are you doing?',
    timestamp: '2024-01-04 10:30:00',
  },
  {
    id: 'msg2',
    from: 'user2',
    to: 'user1',
    text: 'Hi Alice! I am doing great, thanks for asking!',
    timestamp: '2024-01-04 10:32:00',
  },
  {
    id: 'msg3',
    from: 'user1',
    to: 'user2',
    text: 'Want to grab coffee later?',
    timestamp: '2024-01-04 10:35:00',
  },
  {
    id: 'msg4',
    from: 'user2',
    to: 'user1',
    text: 'Sure! How about 3 PM at the usual place?',
    timestamp: '2024-01-04 10:37:00',
  },
  {
    id: 'msg5',
    from: 'user3',
    to: 'user1',
    text: 'Alice, did you see the new project updates?',
    timestamp: '2024-01-04 11:00:00',
  },
  {
    id: 'msg6',
    from: 'user1',
    to: 'user3',
    text: 'Yes! I reviewed them this morning.',
    timestamp: '2024-01-04 11:05:00',
  },
];

/**
 * Mock channel messages
 */
export const MOCK_CHANNEL_MESSAGES: ChannelMessage[] = [
  {
    id: 'cmsg1',
    channel: 'channel1',
    author: 'user1',
    text: 'Good morning everyone! Ready for the standup?',
    timestamp: '2024-01-04 09:00:00',
  },
  {
    id: 'cmsg2',
    channel: 'channel1',
    author: 'user2',
    text: 'Morning! Yes, just finishing my coffee ☕',
    timestamp: '2024-01-04 09:02:00',
  },
  {
    id: 'cmsg3',
    channel: 'channel1',
    author: 'user3',
    text: 'I am ready to go!',
    timestamp: '2024-01-04 09:03:00',
  },
  {
    id: 'cmsg4',
    channel: 'channel2',
    author: 'user4',
    text: 'Anyone watching the game tonight?',
    timestamp: '2024-01-04 15:30:00',
  },
  {
    id: 'cmsg5',
    channel: 'channel2',
    author: 'user5',
    text: 'Yes! I am so excited!',
    timestamp: '2024-01-04 15:32:00',
  },
  {
    id: 'cmsg6',
    channel: 'channel3',
    author: 'user1',
    text: '📢 Important: System maintenance tomorrow at 2 AM UTC',
    timestamp: '2024-01-04 14:00:00',
  },
  {
    id: 'cmsg7',
    channel: 'channel4',
    author: 'user2',
    text: 'The new dashboard is looking amazing!',
    timestamp: '2024-01-04 13:45:00',
  },
  {
    id: 'cmsg8',
    channel: 'channel4',
    author: 'user3',
    text: 'Great work everyone! Ship it! 🚀',
    timestamp: '2024-01-04 13:50:00',
  },
  {
    id: 'cmsg9',
    channel: 'channel5',
    author: 'user4',
    text: 'How do I reset my password?',
    timestamp: '2024-01-04 12:00:00',
  },
  {
    id: 'cmsg10',
    channel: 'channel5',
    author: 'user1',
    text: 'Go to settings > account > reset password',
    timestamp: '2024-01-04 12:05:00',
  },
];
