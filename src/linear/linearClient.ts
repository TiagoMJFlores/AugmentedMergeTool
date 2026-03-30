import 'dotenv/config';
import { LinearClient } from '@linear/sdk';

let _client: LinearClient | null = null;

export function getLinearClient(): LinearClient {
  if (!_client) {
    if (!process.env.LINEAR_API_KEY) {
      throw new Error('LINEAR_API_KEY is not set. Add it to your .env file.');
    }
    _client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
  }
  return _client;
}
