import { basename, dirname, isAbsolute, join } from 'node:path'
import { identifyDocument } from '../config/model.js'
import { loadDocuments } from '../features/workspace.js'
import { inspectExternalReference } from '../storage/workspace.js'
import { confirm, leave, open, prompt } from './documents.js'
import { invalidateDoctor, operation } from './operations.js'
import { setField } from './state.js'

export function filePicker(app, field) {
  const editor = app.state.editor
  confirm(
    app,
    app.t('{field}: file action', { field: field.label }),
    ['Cancel', 'Copy into workspace', 'Reference external file', 'Remove reference'],
    (index) => {
      if (index === 3) {
        setField(editor, field, '')
        app.update()
        return
      }
      if (index !== 1 && index !== 2)
        return
      prompt(app, 'Source file: absolute path', async (source) => {
        const valid = await operation(app, 'Checking source file', async () => {
          const info = await inspectExternalReference(source)
          if (!info.exists)
            throw Object.assign(new Error('Missing file'), { code: 'ENOENT' })
        })
        if (!valid)
          return
        if (index === 2) {
          confirm(
            app,
            'Use read-only external reference?',
            ['Cancel', 'Use reference'],
            (selected) => {
              if (selected) {
                setField(editor, field, source)
                app.state.status = app.t(
                  'External file is read-only and will not move with this workspace.',
                )
                app.update()
              }
            },
            source,
          )
          return
        }
        prompt(
          app,
          'Destination relative to workspace',
          destination => confirmCopy(app, source, destination, editor, field),
          join(dirname(editor.path), basename(source)),
          app.t('No traversal. Copy never modifies the source file.'),
        )
      })
    },
    app.t('External references are read-only. Removing a reference never deletes its source.'),
  )
}

export async function confirmCopy(app, source, destination, editor, field) {
  let exists = false
  let expectedRevision
  const checked = await operation(app, 'Checking copy destination', async () => {
    if (isAbsolute(destination))
      throw Object.assign(new Error('Invalid destination'), { code: 'INVALID_PATH' })
    expectedRevision = (await app.session.readBytes(destination)).revision
    exists = expectedRevision !== null
  })
  if (!checked)
    return
  confirm(
    app,
    exists ? 'Overwrite this workspace file?' : 'Copy file now?',
    ['Cancel', exists ? 'Overwrite file' : 'Copy file'],
    async (index) => {
      if (!index)
        return
      await operation(
        app,
        app.t('Copying to {path}', { path: destination }),
        async () => {
          const reference = await app.session.importFile(source, destination, {
            overwrite: exists,
            expectedRevision,
          })
          if (editor && field)
            setField(editor, field, reference)
          app.state.managedFiles = await app.session.list()
          if (app.isFiles()) {
            app.state.files = app.state.managedFiles
            app.state.target = app.items().find(item => item.path === destination) || app.state.target
          }
          invalidateDoctor(app)
          if (identifyDocument(destination))
            app.state.documents = await loadDocuments(app.session, { includeExamples: true })
          app.state.status = app.t(
            editor
              ? 'File copy committed. Save the draft to link it; discarding the draft retains this independently imported file.'
              : 'Imported {path}. Presence does not imply credential validity.',
            { path: destination },
          )
        },
        true,
      )
    },
    app.t(
      '{source}\n-> {destination}\nThis is an independent file commit. Canceling later form edits will NOT undo this copy.',
      { source, destination },
    ),
  )
}

export function openFile(app, item) {
  const document = app.state.documents.find(document => document.path === item.path)
  if (document)
    return open(app, document)
  if (item.missing && !item.instructionOnly) {
    return prompt(
      app,
      'Source file: absolute path',
      source => confirmCopy(app, source, item.path),
      '',
      app.t('Import a real file to {path}. The example instructions remain unchanged.', {
        path: item.path,
      }),
    )
  }
  confirm(
    app,
    'Managed file',
    ['Close'],
    () => {},
    item.instructionOnly
      ? app.t(
          'Legacy credential instructions have no typed destination. Use a configuration file field to import the correct credential.',
        )
      : item.path,
  )
}

export async function showFiles(app) {
  return leave(app, async () => {
    await operation(app, 'Listing managed files', async () => {
      app.state.managedFiles = await app.session.list()
      app.state.files = app.state.managedFiles
      app.state.documents = await loadDocuments(app.session, { includeExamples: true })
      invalidateDoctor(app)
      app.state.editor = null
      app.state.selected = 0
      app.state.search = ''
      app.state.detailScroll = 0
      app.state.activeGroup = 4
      app.state.activeTab = 0
      app.state.lastGroup = 4
      app.state.groups[3].tab = 0
      app.state.groups[3].indices[0] = 0
      app.state.groups[3].searches[0] = ''
      app.state.target = app.items()[0] || null
      app.state.focus = 'group4'
      app.state.status = app.t('Managed files')
    })
  })
}

export function deleteSelected(app) {
  const item = app.activeItem()
  if (!item || item.missing)
    return
  if (item.path === 'app.json') {
    app.state.status = app.t('The App document cannot be deleted inside an open workspace.')
    app.update()
    return
  }
  return leave(app, async () => {
    let expectedRevision = app.state.documents.find(document => document.path === item.path)?.revision
    if (expectedRevision === undefined) {
      const checked = await operation(app, 'Checking copy destination', async () => {
        expectedRevision = (await app.session.readBytes(item.path)).revision
      })
      if (!checked)
        return
    }
    confirm(
      app,
      'Delete this one workspace file?',
      ['Cancel', 'Delete file'],
      async (index) => {
        if (!index)
          return
        await operation(
          app,
          app.t('Deleting {path}', { path: item.path }),
          async () => {
            await app.session.removeFile(item.path, expectedRevision)
            app.state.documents = await loadDocuments(app.session, { includeExamples: true })
            app.state.managedFiles = await app.session.list()
            if (app.isFiles())
              app.state.files = app.state.managedFiles
            invalidateDoctor(app)
            app.state.selected = Math.min(app.state.selected, Math.max(0, app.items().length - 1))
            app.state.editor = null
            app.state.target = app.items()[app.state.selected] || null
            app.state.detailScroll = 0
            app.state.status = app.t(
              'Deleted selected file only. References may now be missing; run Doctor.',
            )
          },
          true,
        )
      },
      app.t('{path}\nNo directories are recursively deleted. This cannot be undone.', {
        path: item.path,
      }),
      true,
    )
  })
}
