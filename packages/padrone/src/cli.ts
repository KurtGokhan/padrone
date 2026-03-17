import { createPadrone } from 'padrone';
import pkg from 'padrone/package.json' with { type: 'json' };

const program = createPadrone('padrone').configure({
  version: pkg.version,
  title: 'Padrone CLI',
  description: 'The Padrone CLI',
});

try {
  const cliRes = await program.cli();
  await cliRes.result;
} catch (error) {
  console.error('Error running Padrone CLI:', error);
  process.exit(1);
}
