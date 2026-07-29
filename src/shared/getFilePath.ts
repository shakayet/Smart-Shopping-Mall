/* eslint-disable no-undef */
type IFolderName = 'image' | 'media' | 'doc';

type UploadedFiles =
  | { [fieldname: string]: Express.Multer.File[] }
  | Express.Multer.File[]
  | undefined;

export const getSingleFilePath = (
  files: UploadedFiles,
  folderName: IFolderName,
): string | undefined => {
  if (!files || Array.isArray(files)) return undefined;
  const fileField = files?.[folderName];
  if (fileField && Array.isArray(fileField) && fileField.length > 0) {
    return `/${folderName}/${fileField[0].filename}`;
  }

  return undefined;
};

export const getMultipleFilesPath = (
  files: UploadedFiles,
  folderName: IFolderName,
): string[] | undefined => {
  if (!files || Array.isArray(files)) return undefined;
  const folderFiles = files?.[folderName];
  if (folderFiles && Array.isArray(folderFiles)) {
    return folderFiles.map(file => `/${folderName}/${file.filename}`);
  }

  return undefined;
};
