import 'dotenv/config';
import { LinearClient } from '@linear/sdk';

if (!process.env.LINEAR_API_KEY) {
  throw new Error('LINEAR_API_KEY is not set. Add it to your .env file.');
}

export const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY,
});
