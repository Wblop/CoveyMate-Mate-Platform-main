import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'ui-file-dropzone',
  standalone: true,
  templateUrl: './file-dropzone.component.html',
  styleUrl: './file-dropzone.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIFileDropzoneComponent {
  @Output() filesDropped = new EventEmitter<File[]>();

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }
    this.filesDropped.emit(Array.from(files));
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    this.filesDropped.emit(Array.from(input.files));
    input.value = '';
  }
}
