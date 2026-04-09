import { renderFrame } from '../../frame.ts';
import type { Cut } from '../../../agents/01_plan/schema.ts';
import type { ProductInfo } from '../../../agents/00_ingest/schema.ts';
import type { Template } from '../Standard/index.ts';

export const MinimalTemplate: Template = {
  name: 'Minimal',

  async renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer> {
    const showPrice = cut.index === 19 && productInfo.price > 0;
    return renderFrame(productInfo.imagePath, {
      text: cut.text || productInfo.title,
      subText: showPrice ? `¥${productInfo.price.toLocaleString()} で購入` : undefined,
    });
  },
};
