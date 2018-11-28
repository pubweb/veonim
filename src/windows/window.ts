import { createWebGLView, size as windowsGridSize } from '../windows/window-manager'
import CreateWindowNameplate, { NameplateState } from '../windows/nameplate'
import { highlightLookup } from '../render/highlight-attributes'
import { getCharFromIndex } from '../render/font-texture-atlas'
import { specs as titleSpecs } from '../core/title'
import { cell } from '../core/canvas-container'
import { WebGLView } from '../render/webgl'
import { makel } from '../ui/vanilla'
import nvim from '../core/neovim'

export interface WindowInfo {
  id: string
  gridId: string
  row: number
  col: number
  width: number
  height: number
  visible: boolean
}

interface GridStyle {
  gridRow: string
  gridColumn: string
}

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

export interface WindowOverlay {
  remove(): void
  move(row: number, col: number): void
}

interface PosOpts {
  within: boolean
}

interface HighlightCell {
  row: number
  col: number
  char: string
}

export interface Editor {
  getChar(row: number, col: number): string
  getLine(row: number): string
  getAllLines(): string[]
  findHighlightCells(highlightGroup: string): HighlightCell[]
  positionToEditorPixels(editorLine: number, editorColumn: number, opts?: PosOpts): Position
}

export interface Window {
  id: string
  gridId: string
  webgl: WebGLView
  element: HTMLElement
  editor: Editor
  rows: number
  cols: number
  getWindowInfo(): WindowInfo
  setWindowInfo(info: WindowInfo): void
  applyGridStyle(gridStyle: GridStyle): void
  refreshLayout(): void
  hide(): void
  maybeHide(): void
  maybeShow(): void
  redrawFromGridBuffer(): void
  updateNameplate(data: NameplateState): void
  addOverlayElement(element: HTMLElement): WindowOverlay
  removeOverlayElement(element: HTMLElement): void
  positionToWorkspacePixels(row: number, col: number, opts?: PosOpts): Position
  getWindowSize(): Size
  resizeWindow(width: number, height: number): void
}

const edgeDetection = (el: HTMLElement) => {
  const size = el.getBoundingClientRect()
  const top = Math.round(size.top)
  const bottom = Math.round(size.bottom)
  const left = Math.round(size.left)
  const right = Math.round(size.right)
  const edges = Object.create(null)

  if (left === 0) edges.borderLeft = 'none'
  if (top === titleSpecs.height) edges.borderTop = 'none'
  if (bottom - titleSpecs.height === windowsGridSize.height) edges.borderBottom = 'none'
  if (right === windowsGridSize.width) edges.borderRight = 'none'
  return edges
}

export default () => {
  const wininfo: WindowInfo = { id: '0', gridId: '0', row: 0, col: 0, width: 0, height: 0, visible: true }
  const layout = { x: 0, y: 0, width: 0, height: 0 }
  const webgl = createWebGLView()

  const container = makel({
    flexFlow: 'column',
    background: 'none',
    display: 'flex',
  })

  const content = makel({
    display: 'flex',
    flex: 1,
    background: 'none',
    position: 'relative',
  })

  const overlay = makel({
    display: 'flex',
    position: 'absolute',
    width: '100%',
    height: '100%',
  })

  const nameplate = CreateWindowNameplate()

  overlay.setAttribute('wat', 'overlay')
  content.setAttribute('wat', 'content')
  nameplate.element.setAttribute('wat', 'nameplate')

  Object.assign(nameplate.element.style, {
    background: 'var(--background-30)',
  })

  content.appendChild(overlay)
  container.appendChild(nameplate.element)
  container.appendChild(content)

  const api = {
    get id() { return wininfo.id },
    get gridId() { return wininfo.gridId },
    get rows() { return wininfo.height },
    get cols() { return wininfo.width },
    get webgl() { return webgl },
    get element() { return container },
  } as Window

  api.resizeWindow = (width, height) => {
    webgl.resize(height, width)
  }

  api.setWindowInfo = info => {
    if (!wininfo.visible) {
      container.style.display = 'flex'
      webgl.renderGridBuffer()
    }

    container.id = `${info.id}`
    Object.assign(wininfo, info)
  }

  api.getWindowInfo = () => ({ ...wininfo })

  api.positionToWorkspacePixels = (row, col, fuckTypescript) => {
    const { within = false } = fuckTypescript || {} as PosOpts
    const winX = Math.floor(col * cell.width)
    const winY = Math.floor(row * cell.height)
    return {
      x: (within ? 0 : layout.x) + winX,
      y: (within ? 0 : layout.y) + winY,
    }
  }

  api.getWindowSize = () => ({
    width: layout.width,
    height: layout.height,
  })

  api.applyGridStyle = ({ gridRow, gridColumn }) => {
    Object.assign(container.style, { gridColumn, gridRow })
  }

  api.hide = () => {
    wininfo.visible = false
    container.style.display = 'none'
    webgl.clear()
  }

  // maybeHide + maybeShow used for hiding/showing windows when
  // switching between vim instances. nvim controls the true visiblity
  // state of the windows. the maybe funcs show or hide in a way that
  // respects the true nvim visibility state of the windows
  api.maybeHide = () => {
    if (!wininfo.visible) return
    container.style.display = 'none'
    webgl.clear()
  }

  api.maybeShow = () => {
    if (!wininfo.visible) return
    container.style.display = 'flex'
    webgl.renderGridBuffer()
  }

  api.refreshLayout = () => {
    const { top, left, width, height } = content.getBoundingClientRect()

    const x = left
    const y = top - titleSpecs.height

    const same = layout.x === x
      && layout.y === y
      && layout.width === width
      && layout.height === height

    if (same) return

    Object.assign(layout, { x, y, width, height })
    webgl.layout(x, y, width, height)

    Object.assign(container.style, {
      border: '1px solid var(--background-30)',
    }, edgeDetection(container))
  }

  api.addOverlayElement = element => {
    overlay.appendChild(element)
    return {
      remove: () => element.remove(),
      move: (row: number, col: number) => {
        // TODO: i like to move it move it
        console.warn('NYI: overlay element move', row, col)
      }
    }
  }

  api.redrawFromGridBuffer = () => webgl.renderGridBuffer()

  api.updateNameplate = data => nameplate.update(data)

  api.editor = {
    getChar: (row, col) => {
      const buf = webgl.getGridCell(row, col)
      return getCharFromIndex(buf[3] || 0)
    },
    getLine: row => {
      const buf = webgl.getGridLine(row)
      let line = ''
      for (let ix = 0; ix < buf.length; ix+=4) {
        const charIndex = buf[ix + 3]
        line += getCharFromIndex(charIndex)
      }
      return line
    },
    getAllLines: () => {
      const lines = []
      for (let row = 0; row < wininfo.height; row++) {
        lines.push(api.editor.getLine(row))
      }
      return lines
    },
    findHighlightCells: highlightGroup => {
      const highlights = highlightLookup(highlightGroup).map(m => m.hlid)
      if (!highlights.length) return []

      const results = []

      for (let row = 0; row < wininfo.height; row++) {
        for (let col = 0; col < wininfo.width; col++) {
          const buf = webgl.getGridCell(row, col)
          if (highlights.includes(buf[2])) results.push({
            col: buf[0],
            row: buf[1],
            char: getCharFromIndex(buf[3])
          })
        }
      }

      return results
    },
    positionToEditorPixels: (line, col, fuckTypescript) => {
      const { within = false } = fuckTypescript || {} as PosOpts
      const row = line - nvim.state.editorTopLine
      const winX = Math.floor(col * cell.width)
      const winY = Math.floor(row * cell.height)
      return {
        x: (within ? 0 : layout.x) + winX,
        y: (within ? 0 : layout.y) + winY,
      }
    },
  }

  return api
}
