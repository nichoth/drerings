export function paramsFromQueryLike (query:string):URLSearchParams {
    return new URLSearchParams(query.replace(/^[?#]/, ''))
}

export function canvasToSquareBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    if (canvas.width === canvas.height) {
        return canvasToBlob(canvas, type)
    }

    const side = Math.max(canvas.width, canvas.height)
    const squareCanvas = document.createElement('canvas')
    squareCanvas.width = side
    squareCanvas.height = side

    const context = squareCanvas.getContext('2d')
    if (!context) {
        return Promise.reject(
            new Error('Could not create square image context')
        )
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, side, side)
    const x = Math.floor((side - canvas.width) / 2)
    const y = Math.floor((side - canvas.height) / 2)
    context.drawImage(canvas, x, y)

    return canvasToBlob(squareCanvas, type)
}

export function canvasToBlob (
    canvas:HTMLCanvasElement,
    type:string
):Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Could not create image blob'))
                return
            }
            resolve(blob)
        }, type)
    })
}
