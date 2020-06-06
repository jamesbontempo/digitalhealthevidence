const express = require("express");
const parser = require('body-parser');
const favicon = require('serve-favicon')
const fs = require("fs");
const path = require("path")
const https = require("https");
const Feed = require("feed").Feed;

const baseQuery = "\"digital health\"[Text Word] OR eHealth OR mhealth";

const eutils = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const esearch = "esearch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&usehistory=y";
const esummary = "efetch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&retmax=10&rettype=xml";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fetch = async (url) => {
    return new Promise((resolve, reject) => {
        const request = https.get(new URL(url), (response) => {
            var data = "";
            response.on("data", (chunk) => {
                data += chunk;
            });
            response.on("end", () => {
                resolve(data);
            });
        });
        request.on("error", (err) => {
            reject(err);
        });
    });
};

const processSearch = (data) => {
    const result = data.split("\n").join("");
    var count = ((count = result.match(/<Count>(.+?)<\/Count>/))) ? count[1] : 0;
    var queryKey = ((queryKey = result.match(/<QueryKey>(.+?)<\/QueryKey>/))) ? queryKey[1] : "";
    var webEnv = ((webEnv = result.match(/<WebEnv>(.+?)<\/WebEnv>/))) ? webEnv[1] : "";
    return [count, queryKey, webEnv];
}

const processSummary = (data) => {
    var summaries = [];
    const articles = data.split("\n").join("").matchAll(/(<PubmedArticle>.+?<\/PubmedArticle>)/g);
    for (const article of articles) {
        var title = ((title = article[0].match(/<ArticleTitle>(.+?)<\/ArticleTitle>/))) ? title[1] : "";
        var authors = ((authors = Array.from(article[0].matchAll(/<LastName>(.+?)<\/LastName>.*?<Initials>(.+?)<\/Initials>/g)))) ? authors.map(n => n[1] + ", " + n[2]).join("; ") : "";
        var journal = ((journal = article[0].match(/<Title>(.+?)<\/Title>/))) ? journal[1] : "";

        var email = ((email = article[0].match(/<Affiliation>.*?\.\s+(.*?@.*?)\.<\/Affiliation>/))) ? email[1].replace(/Electronic address:\s+/, "") : "unknown@unknown.com";
        var orcid = ((orcid = article[0].match(/<Identifier Source="ORCID">((\w{4}-){3}\w{4})<\/Identifier>/))) ? "https://orcid.org/" + orcid[1] : (email !== "unknown@unknown.com") ? "http://" + email.match(/@(.*)/)[1] : "http://unknown.com";

        var pubYear = ((pubYear = article[0].match(/<PubDate>.*?<Year>(.+?)<\/Year>.*?<\/PubDate>/))) ? pubYear[1] : "";
        var pubMonth = ((pubMonth = article[0].match(/<PubDate>.*?<Month>(.+?)<\/Month>.*?<\/PubDate>/))) ? pubMonth[1] : "";
        var pubDay = ((pubDay = article[0].match(/<PubDate>.*?<Day>(.+?)<\/Day>.*?<\/PubDate>/))) ? parseFloat(pubDay[1]) : "";
        const pubDate = ((pubDay !== "") ? pubDay + " " : "1 ") + ((pubMonth !== "") ? ((!Number.isNaN(parseFloat(pubMonth))) ? months[parseFloat(pubMonth)-1] : pubMonth) + " " : "Dec ") + ((pubYear) ? pubYear : "");

        var pubMedYear = ((pubMedYear = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Year>(.+?)<\/Year>.*?<\/PubMedPubDate>/))) ? pubMedYear[1] : "";
        var pubMedMonth = ((pubMedMonth = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Month>(.+?)<\/Month>.*?<\/PubMedPubDate>/))) ? pubMedMonth[1] : "";
        var pubMedDay = ((pubMedDay = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Day>(.+?)<\/Day>.*?<\/PubMedPubDate>/))) ? pubMedDay[1] : "";
        const pubMedDate = ((pubMedDay !== "") ? pubMedDay + " " : "1 ") + ((pubMedMonth !== "") ? ((!Number.isNaN(parseFloat(pubMedMonth))) ? months[parseFloat(pubMedMonth)-1] : pubMedMonth) + " " : "Dec ") + ((pubMedYear) ? pubMedYear : "");

        var abstract = ((abstract = article[0].match(/(<AbstractText.*>.+<\/AbstractText>)/))) ? abstract[1].replace(/<AbstractText.*?>/g, "").replace(/<\/AbstractText>/g, " ") : "";
        var doi = ((doi = article[0].match(/<ArticleId IdType="doi">(.+?)<\/ArticleId>/))) ? "http://doi.org/" + doi[1] : "";

        summaries.push([{name: "Title", value: title}, {name: "Authors", value: authors}, {name: "Journal", value: journal}, {name: "Publication Date", value: pubDate}, {name: "Date Added to PubMed", value: pubMedDate}, {name: "Abstract", value: abstract}, {name: "Link", value: doi}, {name: "Contact email", value: email}, {name: "ORCID", value: orcid}]);
    }
    return summaries;
};

const getSort = (sort) => {
    switch(sort) {
        case "added":
            return "";
        case "published":
            return "pub date";
        case "relevant":
            return "relevance";
        default:
            return "unknown";
    }
};

const app = express();

app.use(parser.json());
app.use(parser.urlencoded({extended: false}));
app.use(favicon(path.join(__dirname, "static", "favicon.ico")));

app.set("views", "./views");
app.set("view engine", "pug");

app.get("/search/", async (req, res) => {
    const start = Date.now();

    if (req.query.query === undefined) {res.status(400).send("Bad request (missing query)"); return; }
    if (req.query.sort === undefined) {res.status(400).send("Bad request (missing sort)"); return; }

    const query = req.query.query;
    const sort = getSort(req.query.sort);

    if (sort === "unknown") {res.status(400).send("Bad request (unkown sort)"); return; }

    const retstart = (req.query.start && Number.isInteger(parseFloat(req.query.start, 10))) ? parseFloat(req.query.start, 10) : 0;
    var count, queryKey, webEnv, summaries;

    const searchResults = await fetch(eutils + esearch + "&sort=" + sort + "&term=" + baseQuery + ((query && query !== "") ? " AND (" + query + ")" : ""));
    [count, queryKey, webEnv] = processSearch(searchResults);

    var next, window;

    if (query || query === "") {
        if (retstart < (count - 10)) {
             next = "/search/?query=" + query + "&start=" + (retstart + 10) + "&sort=" + req.query.sort;
             window = [retstart + 1, retstart + 10];
         } else {
             next = null;
             window = [retstart + 1, count];
        }

        const summaryResults = await fetch(eutils + esummary + "&query_key=" + queryKey + "&WebEnv=" + webEnv + "&retstart=" + retstart);
        summaries = processSummary(summaryResults);
    } else {
        next = null;
        window = [];
        summaries = [];
    }

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    res.render("search", {query: query, sort: (req.query.sort) ? req.query.sort : "relevant", results: summaries, window: window, count: count, time: (Date.now() - start)/1000, next: next, quickLinks: quickLinks});
});

app.get("/feed/:sort/:format", async (req, res) => {
    if (req.params.sort === undefined) {res.status(400).send("Bad request (missing sort)"); return; }
    if (req.params.format === undefined) {res.status(400).send("Bad request (missing format)"); return; }

    const sort = getSort(req.params.sort);

    var sortDesc;
    switch(req.params.sort) {
        case "relevant":
            sortDesc = "most relevant";
            break;
        case "added":
            sortDesc = "most recently added";
            break;
        case "published":
            sortDesc = "most recently published";
            break;
    }

    var queryKey, webEnv, summaries;

    const searchResults = await fetch(eutils + esearch + "&sort=" + sort + "&term=" + baseQuery);
    [queryKey, webEnv] = processSearch(searchResults).slice(1);

    const summaryResults = await fetch(eutils + esummary + "&query_key=" + queryKey + "&WebEnv=" + webEnv + "&retstart=0");
    summaries = processSummary(summaryResults);

    const feed = new Feed({
        title: "Digital Health Evidence (" + sortDesc + ")",
        description: "The " + sortDesc + " Digital Health evidence",
        id: "http://digitalhealthevidence.net/",
        link: "http://digitalhealthevidence.net/",
        language: "en",
        image: "http://digitalhealthevidence/logo_horizontal_small.png",
        favicon: "http://digitalhealthevidence.net/favicon.ico",
        copyright: "",
        updated: new Date(Date.now()),
        feedLinks: {
            rss: "http://digitalhealthevidence.net/feed/" + req.params.sort + "/rss",
            atom: "http://digitalhealthevidence.net/feed/" + req.params.sort + "/atom",
            json: "http://digitalhealthevidence.net/feed/" + req.params.sort + "/json"
        },
        author: {
            name: "James BonTempo",
            email: "jamesbontempo@gmail.com",
            link: "https://www.linkedin.com/in/jamesbontempo/"
        }
    });

    for (var i = 0; i < summaries.length; i++) {
        var title, authors, journal, abstract, date, pubDate, pubMedDate, email, orcid, link;
        for (var j = 0; j < summaries[i].length; j++) {
            switch(summaries[i][j].name) {
                case "Title":
                    title = summaries[i][j].value;
                    break;
                case "Authors":
                    authors = summaries[i][j].value;
                    break;
                case "Journal":
                    journal = summaries[i][j].value;
                    break;
                case "Publication Date":
                    date = summaries[i][j].value.split(" ");
                    pubDate = new Date(date[2], months.findIndex(e => e == date[1]), date[0]);
                    break;
                case "Date Added to PubMed":
                    date = summaries[i][j].value.split(" ");
                    pubMedDate = new Date(date[2], months.findIndex(e => e == date[1]), date[0]);
                    break;
                case "Abstract":
                    abstract = summaries[i][j].value;
                    break;
                case "Contact email":
                    email = summaries[i][j].value;
                    break;
                case "ORCID":
                    orcid = summaries[i][j].value;
                    break;
                case "Link":
                    link = summaries[i][j].value;
                    break;
            }
        }
        feed.addItem({
            title: title,
            id: link,
            link: link,
            description: title + " - " + journal,
            content: abstract,
            author: [{name: authors, email: email, link: orcid}],
            date: (req.params.sort === "added") ? pubMedDate : pubDate
        });
    }

    switch(req.params.format) {
        case "atom":
            res.set("Content-Type", "application/atom+xml")
            res.send(feed.atom1());
            break;
        case "json":
            res.set("Content-Type", "application/json")
            res.send(feed.json1());
            break;
        default:
            res.set("Content-Type", "application/rss+xml")
            res.send(feed.rss2());
            break;
    }
});

app.get("/:file", (req, res) => {
    res.sendFile(req.params.file, {root: path.join(__dirname, "static")});
});

app.get("/", async (req,res) => {
    const searchResults = await fetch(eutils + esearch + "&term=" + baseQuery);
    var count = processSearch(searchResults)[0];
    count -= (count % 1000);

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    res.render("index", {count: count, quickLinks: quickLinks});
});

const server = app.listen(3100, () => {
    const now = new Date();
    console.log(now.toUTCString() + " - Digital Health Evidence listening on port 3100 (PID: " + process.pid + ")");
});

process.on("SIGTERM", () => {
    const now = new Date();
    server.close( () => { console.log (now.toUTCString() + " - Digital Health Evidence terminated"); } );
});
