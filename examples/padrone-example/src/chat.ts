import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { MOCK_CHANNEL_MESSAGES, MOCK_CHANNELS, MOCK_PRIVATE_MESSAGES, MOCK_USERS } from './chat-mocks';

// ============================================================================
// Helper Functions
// ============================================================================

function getUserName(userId: string): string {
  return MOCK_USERS.find((u) => u.id === userId)?.name || 'Unknown User';
}

// ============================================================================
// CLI Program
// ============================================================================

export const chatProgram = createPadrone('chat')
  .command('login', (c) =>
    c
      .configure({
        title: 'Login to chat',
      })
      .options(
        z.object({
          userId: z.string().describe('User ID to login as'),
        }),
        { positional: ['userId'] },
      )
      .action((options) => {
        const user = MOCK_USERS.find((u) => u.id === options.userId);

        if (!user) {
          console.error(`❌ User not found: ${options.userId}`);
          console.error(`Available users: ${MOCK_USERS.map((u) => `${u.id} (${u.name})`).join(', ')}`);
          process.exit(1);
        }

        // Set environment variable
        process.env.CHAT_USER_ID = user.id;
        console.log(`✅ Logged in as ${user.name} (${user.email})`);
        console.log(`   User ID: ${user.id}`);
      }),
  )
  .command('list', (c) =>
    c
      .configure({
        title: 'List users and channels',
      })
      .command('users', (c) =>
        c
          .configure({
            title: 'List all users',
          })
          .action(() => {
            console.log('📋 Available Users:\n');
            MOCK_USERS.forEach((user) => {
              console.log(`  • ${user.name}`);
              console.log(`    ID: ${user.id}`);
              console.log(`    Email: ${user.email}\n`);
            });
          }),
      )
      .command('channels', (c) =>
        c
          .configure({
            title: 'List all channels',
          })
          .action(() => {
            console.log('📢 Available Channels:\n');
            MOCK_CHANNELS.forEach((channel) => {
              console.log(`  # ${channel.name}`);
              console.log(`    ID: ${channel.id}`);
              console.log(`    Description: ${channel.description}\n`);
            });
          }),
      ),
  )
  .command('messages', (c) =>
    c
      .configure({
        title: 'View messages',
      })
      .command('dm', (c) =>
        c
          .configure({
            title: 'View direct messages with a user',
          })
          .options(
            z.object({
              userId: z.string().describe('User ID to view messages with'),
            }),
            { positional: ['userId'] },
          )
          .action((options) => {
            const otherUser = MOCK_USERS.find((u) => u.id === options.userId);

            if (!otherUser) {
              console.error(`❌ User not found: ${options.userId}`);
              process.exit(1);
            }

            const messages = MOCK_PRIVATE_MESSAGES.filter((msg) => msg.from === otherUser.id || msg.to === otherUser.id);

            console.log(`💬 Messages with ${otherUser.name}:\n`);

            if (messages.length === 0) {
              console.log('   No messages found.');
              return;
            }

            messages.forEach((msg) => {
              const sender = msg.from === otherUser.id ? `${otherUser.name}` : 'You';
              console.log(`  [${msg.timestamp}] ${sender}: ${msg.text}`);
            });
            console.log('');
          }),
      )
      .command('channel', (c) =>
        c
          .configure({
            title: 'View messages in a channel',
          })
          .options(
            z.object({
              channelId: z.string().describe('Channel ID to view messages from'),
            }),
            { positional: ['channelId'] },
          )
          .action((options) => {
            const channel = MOCK_CHANNELS.find((ch) => ch.id === options.channelId);

            if (!channel) {
              console.error(`❌ Channel not found: ${options.channelId}`);
              process.exit(1);
            }

            const messages = MOCK_CHANNEL_MESSAGES.filter((msg) => msg.channel === channel.id);

            console.log(`📢 Messages in #${channel.name}:\n`);

            if (messages.length === 0) {
              console.log('   No messages found.');
              return;
            }

            messages.forEach((msg) => {
              const authorName = getUserName(msg.author);
              console.log(`  [${msg.timestamp}] ${authorName}: ${msg.text}`);
            });
            console.log('');
          }),
      ),
  );

// Run the CLI if this file is executed directly
if (import.meta.main) {
  try {
    await chatProgram.cli();
  } catch {
    // Error handling
  }
}
