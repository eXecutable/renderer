# Migration Guide: Lightning 3 v3.x to v4.0

This guide covers the breaking changes to the texture lifecycle in 4.0. Apps
that only create textures through nodes and props are not affected; the
changes matter if you call texture lifecycle methods directly, write a custom
`Texture`, or subclass a context texture for a custom renderer.

## Breaking Changes Overview

1. **Only a `Texture` changes its own state** - `state` is read-only and `setState()` is protected
2. **Context textures are stateless** - `load()` returns the size instead of setting state
3. **Texture sources report failure by throwing** - not by setting `failed`
4. **`CoreContextTexture.free()` removed** - use `Texture.free()`
5. **`WebGlCtxTexture.ctxTexture` no longer loads** - it returns `null` until the texture is loaded
6. **`Texture.release()` is protected** - use `Texture.free()`
7. **`Texture.free()` and `Texture.destroy()` are the same** - both always free the source data

## 1. Texture State Ownership

### What Changed

`Texture.state` is a read-only getter and `Texture.setState()` is protected,
so only the texture itself changes its state. `CoreTextureManager` reports
load outcomes through three methods:

- `markLoading()` - fetching the texture's data started
- `markLoaded(dimensions)` - the upload finished
- `markFailed(error)` - fetching or uploading failed

Freeing (`free()`), cancelling (`cancel()`) and context loss
(`invalidateContext()`) are handled by the texture directly.

A `Texture` subclass that derives its state from another texture, like
`SubTexture` does from its parent, keeps calling `this.setState()`.

### v3.x

```typescript
texture.setState('loaded', { w: 100, h: 100 });
texture.state = 'loading';
```

### v4.0

```typescript
texture.markLoaded({ w: 100, h: 100 });
texture.markLoading();
```

Tests that need a mock in a given state can set it with
`Object.assign(mockTexture, { state: 'loaded' })`.

## 2. Stateless Context Textures

### What Changed

A `CoreContextTexture` now holds the resources of a single upload and has
no `state`. `CoreTextureManager` creates a new one for every upload and
records the outcome on the `Texture`. Subclasses implement:

- `load()` - create the drawing resources from `textureSource.textureData`
  and return the loaded size. Throw to fail the load; return `null` when the
  context was lost. Do not change the texture's state or free its data.
- `releaseResources()` - free what `load()` allocated. Memory use is zeroed
  by the base class.
- `invalidateContext()` (optional) - drop handles the browser discarded with
  a lost context.

Upload failures are logged once by `CoreTextureManager`, so subclasses should
not log them.

### v3.x

```typescript
class MyCtxTexture extends CoreContextTexture {
  load(): void {
    this.textureSource.setState('loading');
    // ...create resources
    this.textureSource.setState('loaded', { w, h });
  }

  free(): void {
    this.destroyResources();
    this.textureSource.setState('freed');
  }
}
```

### v4.0

```typescript
class MyCtxTexture extends CoreContextTexture {
  load(): Dimensions | null {
    // ...create resources
    return { w, h };
  }

  protected releaseResources(): void {
    this.destroyResources();
  }
}
```

WebGL subclasses that only change how data is uploaded keep overriding
`onLoadRequest()`.

## 3. Texture Sources Report Failure by Throwing

`getTextureSource()` used to report a failure by setting the texture to
`failed` and returning `{ data: null }`. It now throws, or returns a rejected
promise, and `CoreTextureManager` marks the texture as failed and logs the
error. `{ data: null }` remains valid for textures that have no source data,
like `RenderTexture`.

```typescript
// v3.x
override getTextureSource(): TextureData {
  this.setState('failed', new Error('No image data'));
  return { data: null };
}

// v4.0
override getTextureSource(): TextureData {
  throw new Error('No image data');
}
```

`ImageTexture` failures, such as a failed fetch, are now logged with
`console.error` like other load failures.

## 4. `CoreContextTexture.free()` Removed

Free a texture through its owning `Texture`; it releases the context texture
and moves the texture to `freed`.

```typescript
// v3.x
texture.ctxTexture?.free();

// v4.0
texture.free();
```

## 5. `WebGlCtxTexture.ctxTexture` No Longer Loads

Reading `ctxTexture` on an unloaded `WebGlCtxTexture` used to start a load.
It now returns `null` until the texture has been loaded, and again after
release or context loss. Load textures through the owning `Texture`, which
fetches fresh data:

```typescript
texture.load();
```

## 6. `Texture.release()` Is Protected

`release()` drops the context texture without changing state, which left a
loaded texture marked `loaded` with nothing to bind. Call `free()` instead.

## 7. `Texture.free()` and `Texture.destroy()`

`free()` now also frees the source data of a texture that never reached the
renderer, and `destroy()` simply calls `free()`. Subclasses that override
both to release extra resources only need to override `free()`.
