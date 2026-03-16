import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-quote-workflow',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing-quote-workflow.component.html',
  styleUrl: './landing-quote-workflow.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingQuoteWorkflowComponent {}
