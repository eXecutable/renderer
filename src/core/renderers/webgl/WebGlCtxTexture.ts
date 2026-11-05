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

import type { Dimensions } from '../../../common/CommonTypes.js';
import type { TextureMemoryManager } from '../../TextureMemoryManager.js';
import type { GlContextWrapper } from '../../platforms/GlContextWrapper.js';
import type { Texture } from '../../textures/Texture.js';
import { CoreContextTexture } from '../CoreContextTexture.js';
import { isHTMLImageElement } from './internal/RendererUtils.js';
import type { Bound } from '../../lib/utils.js';
import { isProductionEnvironment } from '../../../utils.js';
import { hasImageBitmap } from '../../platforms/capabilities.js';

const TRANSPARENT_TEXTURE_DATA = new Uint8Array([0, 0, 0, 0]);

class ContextLostError extends Error {}

/**
 * A wrapper around a WebGLTexture that handles loading the texture data
 * from a Texture source and uploading it to the GPU as well as freeing
 * the uploaded texture.
 *
 * @remarks
 * ctxTexture is `null` until {@link CoreContextTexture.load} has uploaded
 * the data, and again after release or context loss. Reloading goes through
 * the owning {@link Texture}, which fetches fresh data and creates a new
 * instance.
 */
export class WebGlCtxTexture extends CoreContextTexture {
  protected _nativeCtxTexture: WebGLTexture | null = null;

  override invalidateContext(): void {
    this._nativeCtxTexture = null;
  }
  private _w = 0;
  private _h = 0;

  txCoords: Bound = {
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  };

  constructor(
    protected glw: GlContextWrapper,
    memManager: TextureMemoryManager,
    textureSource: Texture,
  ) {
    super(memManager, textureSource);
  }

  /**
   * Throw on a GL error, with {@link ContextLostError} for a lost context.
   */
  private checkGLError(): void {
    if (isProductionEnvironment === true) return;
    const error = this.glw.getError();
    if (error === 0) return;
    if (error === 0x9242 || this.glw.isContextLost() === true) {
      this.textureSource.notifyContextLost();
      throw new ContextLostError();
    }
    throw new Error(`WebGL Error: ${error}`);
  }

  get ctxTexture(): WebGLTexture | null {
    return this._nativeCtxTexture;
  }

  get w() {
    return this._w;
  }

  get h() {
    return this._h;
  }

  /**
   * Create the GL texture and upload the source data to the GPU
   */
  load(): Dimensions | null {
    this._nativeCtxTexture = this.createNativeCtxTexture();

    if (this._nativeCtxTexture === null) {
      if (this.glw.isContextLost() === true) {
        this.textureSource.notifyContextLost();
        return null;
      }
      throw new Error('Could not create WebGL Texture');
    }

    let size: Dimensions;
    try {
      size = this.onLoadRequest();
    } catch (err: unknown) {
      if (err instanceof ContextLostError) return null;
      throw err;
    }

    this._w = size.w;
    this._h = size.h;
    return size;
  }

  /**
   * Called when the texture data needs to be loaded and uploaded to a texture
   */
  onLoadRequest(): Dimensions {
    const { glw } = this;
    const textureData = this.textureSource.textureData;
    if (textureData === null || this._nativeCtxTexture === null) {
      throw new Error(
        'Texture data or native texture is null ' + this.textureSource.type,
      );
    }

    // Set to a 1x1 transparent texture
    glw.texImage2D(0, glw.RGBA, 1, 1, 0, glw.RGBA, glw.UNSIGNED_BYTE, null);
    this.setTextureMemUse(TRANSPARENT_TEXTURE_DATA.byteLength);

    let w = 0;
    let h = 0;

    glw.activeTexture(0);

    const tdata = textureData.data;
    const format = glw.RGBA;
    const formatBytes = 4;
    const memoryPadding = 1.1; // Add padding to account for GPU Padding
    const isImageBitmap =
      hasImageBitmap === true && tdata instanceof ImageBitmap;
    const isHTMLCanvas =
      typeof HTMLCanvasElement !== 'undefined' &&
      tdata instanceof HTMLCanvasElement;

    // If textureData is null, the texture is empty (0, 0) and we don't need to
    // upload any data to the GPU.
    if (
      isImageBitmap === true ||
      isHTMLCanvas === true ||
      tdata instanceof ImageData ||
      // not using typeof HTMLImageElement due to web worker
      isHTMLImageElement(tdata) === true
    ) {
      w = tdata.width;
      h = tdata.height;
      glw.bindTexture(this._nativeCtxTexture);

      // Premultiply on upload only when requested and the pixels aren't
      // already premultiplied. When the source doesn't say, assume
      // ImageBitmaps are premultiplied and other sources are straight alpha.
      glw.pixelStorei(
        glw.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        !!textureData.premultiplyAlpha &&
          !(textureData.premultiplied ?? isImageBitmap),
      );

      glw.texImage2D(0, format, format, glw.UNSIGNED_BYTE, tdata);

      // Check for errors after compressed texture operations
      this.checkGLError();

      this.setTextureMemUse(h * w * formatBytes * memoryPadding);
    } else if (tdata === null) {
      w = 0;
      h = 0;
      // Reset to a 1x1 transparent texture
      glw.bindTexture(this._nativeCtxTexture);

      glw.texImage2D(
        0,
        format,
        1,
        1,
        0,
        format,
        glw.UNSIGNED_BYTE,
        TRANSPARENT_TEXTURE_DATA,
      );
      this.setTextureMemUse(TRANSPARENT_TEXTURE_DATA.byteLength);
    } else if ('mipmaps' in tdata && tdata.mipmaps) {
      const { mipmaps, type, blockInfo } = tdata;
      glw['upload' + type]!(this._nativeCtxTexture, tdata);

      // Check for errors after compressed texture operations
      this.checkGLError();

      w = tdata.w;
      h = tdata.h;
      this.txCoords.x2 = w / (Math.ceil(w / blockInfo.width) * blockInfo.width);
      this.txCoords.y2 =
        h / (Math.ceil(h / blockInfo.height) * blockInfo.height);

      this.setTextureMemUse(mipmaps[0]?.byteLength ?? 0);
    } else if (tdata && tdata instanceof Uint8Array) {
      // Color Texture
      w = 1;
      h = 1;

      glw.bindTexture(this._nativeCtxTexture);
      glw.pixelStorei(
        glw.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        !!textureData.premultiplyAlpha,
      );

      glw.texImage2D(0, format, w, h, 0, format, glw.UNSIGNED_BYTE, tdata);

      // Check for errors after compressed texture operations
      this.checkGLError();

      this.setTextureMemUse(w * h * formatBytes);
    } else {
      throw new Error(
        `WebGlCoreCtxTexture.onLoadRequest: Unexpected textureData returned`,
      );
    }

    return {
      w,
      h,
    };
  }

  protected releaseResources(): void {
    this._w = 0;
    this._h = 0;

    if (this._nativeCtxTexture !== null) {
      this.glw.deleteTexture(this._nativeCtxTexture);
      this._nativeCtxTexture = null;
    }
  }

  /**
   * Create native context texture asynchronously
   *
   * @remarks
   * When this method resolves, the returned texture will be bound to the GL context state
   * and fully ready for use. This ensures proper GPU resource allocation timing.
   *
   * @returns Promise that resolves to the native WebGL texture or null on failure
   */
  protected createNativeCtxTexture(): WebGLTexture | null {
    const { glw } = this;

    const nativeTexture = glw.createTexture();
    if (!nativeTexture) {
      return null;
    }

    // On initial load request, create a 1x1 transparent texture to use until
    // the texture data is finally loaded.
    glw.activeTexture(0);
    glw.bindTexture(nativeTexture);

    // linear texture filtering
    glw.texParameteri(glw.TEXTURE_MAG_FILTER, glw.LINEAR);
    glw.texParameteri(glw.TEXTURE_MIN_FILTER, glw.LINEAR);

    // texture wrapping method
    glw.texParameteri(glw.TEXTURE_WRAP_S, glw.CLAMP_TO_EDGE);
    glw.texParameteri(glw.TEXTURE_WRAP_T, glw.CLAMP_TO_EDGE);

    return nativeTexture;
  }
}
