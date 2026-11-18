import { TestBed } from '@angular/core/testing';
import { StarInput, Stars } from './stars';

describe('Stars', () => {
  it('rounds to whole stars and describes the exact value', () => {
    const fixture = TestBed.createComponent(Stars);
    fixture.componentRef.setInput('value', 4.4);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent?.trim()).toBe('★★★★☆');
    expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('4.4 out of 5 stars');
  });

  it('stays within zero to five stars', () => {
    const fixture = TestBed.createComponent(Stars);
    fixture.componentRef.setInput('value', 9);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('★★★★★');
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('☆☆☆☆☆');
  });
});

describe('StarInput', () => {
  it('picks a rating from one to five', () => {
    const fixture = TestBed.createComponent(StarInput);
    fixture.detectChanges();
    const picked: number[] = [];
    fixture.componentInstance.value.subscribe(value => picked.push(value));
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(5);
    buttons[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(3);
    expect(picked).toEqual([3]);
    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
    expect(buttons[3].getAttribute('aria-checked')).toBe('false');
  });
});
