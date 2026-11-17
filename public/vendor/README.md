# Bundled third-party files

These are served from your own site, so photo search works without any outside service.

| File | Source | License |
|---|---|---|
| `tf.min.js` | TensorFlow.js 4.22.0 (`@tensorflow/tfjs` on npm) | Apache-2.0 |
| `mobilenet_v2/` | MobileNet V2 1.0 224 image model, published by the TensorFlow.js team at `storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/` | Apache-2.0 |

The app uses the model's image-feature layer (`module_apply_default/MobilenetV2/Logits/AvgPool`, 1280 numbers per photo) to compare photos.
