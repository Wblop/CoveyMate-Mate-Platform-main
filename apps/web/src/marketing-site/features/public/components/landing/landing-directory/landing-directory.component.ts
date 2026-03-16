import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-landing-directory',
  standalone: true,
  templateUrl: './landing-directory.component.html',
  styleUrl: './landing-directory.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingDirectoryComponent {}
