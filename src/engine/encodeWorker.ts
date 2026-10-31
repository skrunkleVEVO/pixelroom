// JPEG encoding off the main thread. Browsers' canvas encoders use 4:2:0 chroma below
// quality 100, which smears saturated edges. MozJPEG with 4:4:4 keeps full colour.
import encode from '@jsquash/jpeg/encode';

export interface EncodeRequest {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
}

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { rgba, width, height, quality } = event.data;
  try {
    const jpeg = await encode(new ImageData(new Uint8ClampedArray(rgba), width, height), {
      quality,
      progressive: true,
      optimize_coding: true,
      auto_subsample: false,
      chroma_subsample: 1,
      separate_chroma_quality: false,
    });
    (self as unknown as Worker).postMessage({ jpeg }, [jpeg]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      error: error instanceof Error ? error.message : 'JPEG encoding failed.',
    });
  }
};
