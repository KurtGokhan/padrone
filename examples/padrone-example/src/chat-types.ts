/**
 * User entity
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Channel entity
 */
export interface Channel {
  id: string;
  name: string;
  description: string;
}

/**
 * Private message between two users
 */
export interface PrivateMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
}

/**
 * Message posted in a channel
 */
export interface ChannelMessage {
  id: string;
  channel: string;
  author: string;
  text: string;
  timestamp: string;
}
