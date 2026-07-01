export const CHROMELESS_TEMPLATE = `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title id="document-title">{{title}}</title>
  <meta name="description" content="{{description}}">
  <meta name="robots" content="{{robots}}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"></noscript>

  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/fontawesome.min.css" as="style" integrity="sha384-5t0634b3BeTSoxIIgd8lhUy22xY2BGs89gw0vReAMGcfJXXfA7fblIRGVkRFWRDL" crossorigin="anonymous" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/fontawesome.min.css" integrity="sha384-5t0634b3BeTSoxIIgd8lhUy22xY2BGs89gw0vReAMGcfJXXfA7fblIRGVkRFWRDL" crossorigin="anonymous"></noscript>
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/solid.min.css" as="style" integrity="sha384-+CMpNM/Tv3YfWmU43LPsvXlIdOUnxSooWv5fY/Tkap65JU4QTLBHp8nMrEkIEb3u" crossorigin="anonymous" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/solid.min.css" integrity="sha384-+CMpNM/Tv3YfWmU43LPsvXlIdOUnxSooWv5fY/Tkap65JU4QTLBHp8nMrEkIEb3u" crossorigin="anonymous"></noscript>
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/brands.min.css" as="style" integrity="sha384-hu7sKftLeB/8IYmWPfl2Jo6MTRHquwXVmGPT/08RqhuANVZrbNFBIsvWPOiUduYX" crossorigin="anonymous" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/brands.min.css" integrity="sha384-hu7sKftLeB/8IYmWPfl2Jo6MTRHquwXVmGPT/08RqhuANVZrbNFBIsvWPOiUduYX" crossorigin="anonymous"></noscript>

  <link rel="icon" type="image/svg+xml" href="{{staticBaseUrl}}/favicon.svg">

  <style>
    {{{baseStyles}}}
    {{{resetStyles}}}
    {{{utilityStyles}}}
  </style>
</head>
<body{{#if bodyClass}} class="{{bodyClass}}"{{/if}}>
  {{{content}}}
  {{{scripts}}}
</body>
</html>
`;
