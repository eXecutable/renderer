import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  class FakeImageBitmap {
    width = 1;
    height = 1;
    close = vi.fn();
  }
  vi.stubGlobal('ImageBitmap', FakeImageBitmap);
});

import { CoreTextureManager } from '../CoreTextureManager.js';
import { ImageTexture, type ImageTextureProps } from './ImageTexture.js';
import type { Stage } from '../Stage.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(src: ImageTextureProps['src']) {
  const bitmap = new ImageBitmap() as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
  const stage = {
    contextState: 'running',
    platform: {
      getTimeStamp: () => 0,
      loadImage: () => Promise.resolve({ data: bitmap }),
      createImage: () => Promise.resolve({ data: bitmap }),
    },
    defaultTexture: null,
  } as unknown as Stage;
  const manager = new CoreTextureManager(stage, {
    maxRetryCount: 5,
    createImageBitmapSupport: 'full',
  });
  const texture = new ImageTexture(
    manager,
    ImageTexture.resolveDefaults({ src }),
  );
  return { manager, texture, bitmap };
}

describe('ImageTexture.cancel', () => {
  it('closes a decoded bitmap waiting in the upload queue', async () => {
    const { manager, texture, bitmap } = setup('image.png');
    texture.setRenderableOwner('a', true);
    await flush();
    expect(manager.isProcessingTexture(texture)).toBe(true);
    expect(texture.textureData?.data).toBe(bitmap);

    texture.setRenderableOwner('a', false);
    await Promise.resolve();

    expect(texture.state).toBe('initial');
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes a queued bitmap decoded from a Blob', async () => {
    const { texture, bitmap } = setup(new Blob());
    texture.setRenderableOwner('a', true);
    await flush();

    texture.setRenderableOwner('a', false);
    await Promise.resolve();

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('does not close a caller-provided bitmap', async () => {
    const bitmap = new ImageBitmap() as ImageBitmap & {
      close: ReturnType<typeof vi.fn>;
    };
    const { texture } = setup(bitmap);
    texture.setRenderableOwner('a', true);
    expect(texture.textureData?.data).toBe(bitmap);

    texture.setRenderableOwner('a', false);
    await Promise.resolve();

    expect(texture.state).toBe('initial');
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('does not close the bitmap while another owner renders it', async () => {
    const { texture, bitmap } = setup('image.png');
    texture.setRenderableOwner('a', true);
    texture.setRenderableOwner('b', true);
    await flush();

    texture.setRenderableOwner('a', false);
    await Promise.resolve();

    expect(texture.state).toBe('loading');
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('closes the late bitmap once when cancelled mid-fetch', async () => {
    const { texture, bitmap } = setup('image.png');
    texture.setRenderableOwner('a', true);

    texture.setRenderableOwner('a', false);
    await flush();

    expect(texture.state).toBe('initial');
    expect(texture.textureData).toBeNull();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
