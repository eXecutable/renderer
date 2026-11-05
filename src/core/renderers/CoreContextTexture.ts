/*
 * If not stated otherwise in this file or this component's LICENSE file the
 * following copyright and licenses apply:
 *
 * Copyright 2023 Comcast Cable Communications Management, LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the License);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Dimensions } from '../../common/CommonTypes.js';
import type { TextureMemoryManager } from '../TextureMemoryManager.js';
import type { Texture } from '../textures/Texture.js';

/**
 * Renderer-side resources for one upload of a {@link Texture}.
 *
 * @remarks
 * Holds no lifecycle state: {@link load} reports its outcome to the caller
 * and the {@link Texture} records it. Each load creates a new instance.
 */
export abstract class CoreContextTexture {
  readonly textureSource: Texture;
  private memManager: TextureMemoryManager;

  constructor(memManager: TextureMemoryManager, textureSource: Texture) {
    this.memManager = memManager;
    this.textureSource = textureSource;
  }

  protected setTextureMemUse(byteSize: number): void {
    this.memManager.setTextureMemUse(this.textureSource, byteSize);
  }

  /**
   * Create the drawing resources from the texture's source data.
   *
   * @returns
   * The loaded size, or `null` when the context was lost during the upload.
   * Throws when the upload fails.
   */
  abstract load(): Dimensions | null;

  /**
   * Free everything allocated for drawing and zero the memory count.
   */
  release(): void {
    this.releaseResources();
    this.setTextureMemUse(0);
  }

  /**
   * Drop handles the browser has already discarded with the lost context.
   */
  invalidateContext(): void {}

  get renderable(): boolean {
    return this.textureSource.renderable;
  }

  protected abstract releaseResources(): void;
}
