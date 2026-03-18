import { useState, useCallback } from "react";

interface UploadState {
  status: "idle" | "uploading" | "done" | "error";
  progress: number;
  storageKey: string | null;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
}

const initialState: UploadState = {
  status: "idle",
  progress: 0,
  storageKey: null,
  error: null,
  fileName: null,
  fileSize: null,
};

export function useUpload() {
  const [state, setState] = useState<UploadState>(initialState);

  const upload = useCallback(async (file: File) => {
    setState({
      status: "uploading",
      progress: 0,
      storageKey: null,
      error: null,
      fileName: file.name,
      fileSize: file.size,
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Upload file to our server which proxies to Tigris
      const storageKey = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setState((prev) => ({ ...prev, progress: pct }));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const body = JSON.parse(xhr.responseText);
            resolve(body.storageKey);
          } else {
            try {
              const body = JSON.parse(xhr.responseText);
              reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });

      setState({
        status: "done",
        progress: 100,
        storageKey,
        error: null,
        fileName: file.name,
        fileSize: file.size,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { ...state, upload, reset };
}
