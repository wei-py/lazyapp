import {
  createApp,
  documentFields,
  documentPath,
  platformKinds,
  validateDocument,
} from './model.js'

const SIGNING_FILES = {
  android: { keystore: 'signing.keystore' },
  ios: { certificate: 'certificate.p12', provisioningProfile: 'provisioning.mobileprovision' },
  harmony: { certificate: 'certificate.cer', profile: 'profile.p7b', keystore: 'keystore.p12' },
  windows: { certificate: 'certificate.pfx' },
  macos: { certificate: 'certificate.p12', provisioningProfile: 'provisioning.mobileprovision' },
  miniprogram: { privateKey: 'upload.key' },
}

function instruction(en, zh) {
  return { schemaVersion: 1, instruction: { en, zh } }
}

function configurationExample(kind, options = {}) {
  const fields = documentFields(kind, options)
  const data = instruction(
    'Instructional example only; not active configuration. Create the corresponding .json file when ready and fill in actual values. Import your own files later or reference their absolute paths; never rename these instruction files as images or credentials.',
    '仅为说明示例，不是生效配置。准备就绪后创建对应的 .json 文件并填写真实值。稍后导入自己的文件或引用其绝对路径；请勿将说明文件重命名为图片或凭据。',
  )
  for (const field of fields) data[field.key] = field.type === 'number' ? null : ''
  return { path: `${documentPath(kind, options)}.example`, data }
}

/** Plan inert, credential-free examples without modifying the app or filesystem. */
export function initializationExamples(app) {
  const issues = validateDocument('app', app)
  if (issues.length) {
    const error = new Error(issues.map(issue => issue.message).join('; '))
    error.code = 'VALIDATION_FAILED'
    error.issues = issues
    throw error
  }

  const examples = [configurationExample('assets')]
  const resources = [
    ['icon', 'assets/icon/source.png.example'],
    ['splash', 'assets/splash/source.png.example'],
    ['screenshots', 'assets/screenshots/screenshot.png.example'],
    ['promotionalImage', 'assets/promotional/source.png.example'],
  ]
  const assetFields = documentFields('assets')
  const chineseAssetFields = documentFields('assets', { language: 'zh' })
  for (const [key, path] of resources) {
    const label = assetFields.find(field => field.key === key).label
    const chineseLabel = chineseAssetFields.find(field => field.key === key).label
    examples.push({
      path,
      data: instruction(
        `Instructional example for ${label}; this JSON is not an image. Import an actual image later and set the ${key} reference in assets/config.json. Keep this .example file inactive.`,
        `${chineseLabel}的说明示例；此 JSON 不是图片。稍后导入真实图片，并在 assets/config.json 中设置 ${key} 文件引用。此 .example 文件不参与配置。`,
      ),
    })
  }
  examples.push(configurationExample('service', { name: 'service' }))
  examples.push(configurationExample('store', { name: 'store' }))
  for (const name of app.environments) examples.push(configurationExample('environment', { name }))
  for (const kind of app.platforms) {
    examples.push(configurationExample(kind, { scope: 'platform' }))
    const fields = documentFields(kind, { scope: 'signing' }).filter(
      field => field.type === 'file',
    )
    const chineseFields = documentFields(kind, { scope: 'signing', language: 'zh' })
    for (const environment of app.environments) {
      examples.push(configurationExample(kind, { environment, scope: 'signing' }))
      for (const field of fields) {
        const filename = SIGNING_FILES[kind][field.key]
        const target = `platforms/${kind}/${environment}/${filename}`
        const label = chineseFields.find(item => item.key === field.key).label
        examples.push({
          path: `${target}.example`,
          data: instruction(
            `Placeholder for ${field.label}; the real file ${target} is missing. Import your own file at that path, then set the ${field.key} reference in config.json. This JSON is not a credential; do not rename it to pretend the file exists.`,
            `${label}的占位说明；真实文件 ${target} 尚未提供。请导入自己的文件到此路径，再在 config.json 中设置 ${field.key} 引用。此 JSON 不是凭据，不要通过重命名伪造真实文件。`,
          ),
        })
      }
    }
  }
  return examples
}

/** Default scaffold offers supported platforms without enabling any in the live App metadata. */
export function defaultInitialization(name) {
  const app = createApp({ name })
  const templateMetadata = createApp({
    name,
    platforms: platformKinds,
    environments: ['development', 'production'],
  })
  return { app, examples: initializationExamples(templateMetadata) }
}
