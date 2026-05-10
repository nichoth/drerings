import { getStore } from '@netlify/blobs'

export const DRAWING_IMAGE_STORE = 'drawings'

function drawingImageStore () {
    return getStore(DRAWING_IMAGE_STORE)
}

export async function putDrawingImage (
    userId:string,
    drawingId:string,
    blob:Blob
):Promise<string> {
    const blobKey = `users/${userId}/drawings/${drawingId}.png`

    await drawingImageStore().set(blobKey, blob)

    return blobKey
}

export async function getDrawingImage (
    blobKey:string
):Promise<ArrayBuffer|null> {
    const image = await drawingImageStore().get(blobKey, {
        type: 'arrayBuffer'
    }) as ArrayBuffer|null

    return image
}

export async function deleteDrawingImage (
    blobKey:string
):Promise<void> {
    await drawingImageStore().delete(blobKey)
}
