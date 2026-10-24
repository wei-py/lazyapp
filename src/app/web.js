import { startWebServer } from '../web/server.js'
import { operation } from './operations.js'

/** Start the loopback Web editor once; repeated requests keep the existing service. */
export async function startWeb(app, port = 3210) {
  if (app.webService) {
    app.state.status = app.t('Web editor is already running at {url}', { url: app.webService.url })
    app.update()
    return true
  }
  if (app.webStarting)
    return app.webStarting
  app.webStarting = operation(app, 'Starting Web editor', async () => {
    app.webService = await startWebServer(app.projectDir, { port })
    app.state.webUrl = app.webService.url
    app.state.status = app.t('Web editor started at {url}', { url: app.webService.url })
  })
  try {
    return await app.webStarting
  }
  finally {
    app.webStarting = null
  }
}
