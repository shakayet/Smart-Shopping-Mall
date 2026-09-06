import fs from 'fs';
import path from 'path';

const unlinkFile = (file: string) => {
  const uploadRoot = path.resolve(process.cwd(), 'uploads');
  const relativeFile = file.replace(/^[/\\]+/, '');
  const filePath = path.resolve(uploadRoot, relativeFile);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) return;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

export default unlinkFile;
