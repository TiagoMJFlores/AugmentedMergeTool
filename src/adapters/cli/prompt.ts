import * as readline from 'readline';

export async function askUserAction(): Promise<'u' | 's'> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) =>
      rl.question('\n  [U] Use suggestion   [S] Skip\n> ', (ans) => {
        resolve(ans.trim().toLowerCase());
      })
    );

  let answer = '';
  while (answer !== 'u' && answer !== 's') {
    answer = await ask();
  }

  rl.close();
  return answer as 'u' | 's';
}
