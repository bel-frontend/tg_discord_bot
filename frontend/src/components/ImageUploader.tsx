import { useRef, useState } from 'react';
import { uploadImage } from '../api';
import { useToast } from '../toast';

export interface ImageItem {
    id: string;
    filename: string;
    previewUrl: string;
}

interface Props {
    images: ImageItem[];
    onChange: (next: ImageItem[]) => void;
}

export function ImageUploader({ images, onChange }: Props) {
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(0);

    async function addFiles(files: FileList | File[]) {
        const list = Array.from(files).filter((f) =>
            f.type.startsWith('image/'),
        );
        if (!list.length) return;

        // Accumulate locally so sequential uploads don't race on a stale prop.
        const acc = [...images];
        for (const file of list) {
            const previewUrl = URL.createObjectURL(file);
            setUploading((n) => n + 1);
            try {
                const { id, filename } = await uploadImage(file);
                acc.push({ id, filename: filename || file.name, previewUrl });
                onChange([...acc]);
            } catch (err: any) {
                URL.revokeObjectURL(previewUrl);
                toast(err.message, 'error');
            } finally {
                setUploading((n) => n - 1);
            }
        }
    }

    function remove(id: string) {
        const item = images.find((i) => i.id === id);
        if (item) URL.revokeObjectURL(item.previewUrl);
        onChange(images.filter((i) => i.id !== id));
    }

    return (
        <div className="field">
            <span>Images</span>
            <div
                className={`dropzone ${dragOver ? 'over' : ''}`}
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    addFiles(e.dataTransfer.files);
                }}
                onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                        e.preventDefault();
                        addFiles(e.clipboardData.files);
                    }
                }}
            >
                <span className="dropzone-hint">
                    Drop images here, paste, or click to choose
                </span>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                        if (e.target.files) addFiles(e.target.files);
                        e.target.value = '';
                    }}
                />
            </div>

            {(images.length > 0 || uploading > 0) && (
                <div className="thumbs">
                    {images.map((img) => (
                        <div className="thumb" key={img.id}>
                            <img src={img.previewUrl} alt={img.filename} />
                            <button
                                className="thumb-del"
                                title="Remove"
                                onClick={() => remove(img.id)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    {Array.from({ length: uploading }).map((_, i) => (
                        <div className="thumb uploading" key={`u${i}`}>
                            <span className="thumb-spin" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
