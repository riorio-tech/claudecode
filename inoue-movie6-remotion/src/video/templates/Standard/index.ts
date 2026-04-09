import { renderFrame } from '../../frame.ts';
import type { Cut } from '../../../agents/01_plan/schema.ts';
import type { ProductInfo } from '../../../agents/00_ingest/schema.ts';

export interface Template {
  name: string;
  renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer>;
}

export const StandardTemplate: Template = {
  name: 'Standard',

  async renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer> {
    const showPrice = cut.index === 0 && productInfo.price > 0;
    return renderFrame(productInfo.imagePath, {
      text: cut.text || productInfo.title,
      subText: showPrice ? `¥${productInfo.price.toLocaleString()}` : undefined,
    });
  },
};
