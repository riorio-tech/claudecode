import { StandardTemplate } from './Standard/index.ts';
import { MinimalTemplate } from './Minimal/index.ts';
import type { Template } from './Standard/index.ts';

export { type Template };

export function getTemplate(name: string): Template {
  switch (name) {
    case 'Standard': return StandardTemplate;
    case 'Minimal': return MinimalTemplate;
    default: throw new Error(`未知のテンプレート: ${name}`);
  }
}
